import { and, eq } from "drizzle-orm";
import { requestContext, withSystemTx, withTx } from "@casper/platform";
import { dispatchPending, emit } from "@casper/events";
import { parseWorkflowDefinition, type WorkflowDefinition } from "./definition.js";
import { workflowDefinitions } from "./schema.js";
import { setActiveDefinition, tryGetWorkflow } from "./registry.js";

/**
 * Workflow publishing primitives (D-006/D-014/D-026). Definitions are immutable
 * versions; publishing creates version N+1 and repoints the `active` status.
 *
 * These are the **executor** primitives that casper-changesets calls when it commits
 * a `config_publish` change — casper-workflow does not import casper-changesets (the
 * dependency runs one way, changesets → workflow). Emitted events pick up
 * `causationId = changeset` from the ambient emission context the commit establishes.
 */

// ---- diff -------------------------------------------------------------------

export interface WorkflowDiff {
  recordType: string;
  fromVersion: number | null;
  toVersion: number;
  stages: DiffBucket;
  transitions: DiffBucket;
  sla: DiffBucket;
  /** Human-readable one-line-per-change summary (the P1 "human-readable diff"). */
  summary: string[];
}
interface DiffBucket {
  added: string[];
  removed: string[];
  changed: string[];
}

function keyBy<T>(items: T[], key: (t: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) m.set(key(it), it);
  return m;
}

function diffBucket<T>(
  before: Map<string, T>,
  after: Map<string, T>,
): DiffBucket {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const k of after.keys()) {
    if (!before.has(k)) added.push(k);
    else if (JSON.stringify(before.get(k)) !== JSON.stringify(after.get(k))) changed.push(k);
  }
  for (const k of before.keys()) if (!after.has(k)) removed.push(k);
  return { added, removed, changed };
}

const transitionKey = (t: { from: string; to: string }): string => `${t.from}→${t.to}`;

export function diffWorkflow(
  before: WorkflowDefinition | null,
  after: WorkflowDefinition,
): WorkflowDiff {
  const stages = diffBucket(
    keyBy(before?.stages ?? [], (s) => s.key),
    keyBy(after.stages, (s) => s.key),
  );
  const transitions = diffBucket(
    keyBy(before?.transitions ?? [], transitionKey),
    keyBy(after.transitions, transitionKey),
  );
  const sla = diffBucket(
    keyBy(before?.sla ?? [], (r) => r.key),
    keyBy(after.sla, (r) => r.key),
  );

  const summary: string[] = [];
  const line = (bucket: DiffBucket, noun: string) => {
    for (const k of bucket.added) summary.push(`+ ${noun} '${k}'`);
    for (const k of bucket.removed) summary.push(`- ${noun} '${k}'`);
    for (const k of bucket.changed) summary.push(`~ ${noun} '${k}' changed`);
  };
  line(stages, "stage");
  line(transitions, "transition");
  line(sla, "SLA rule");
  if (summary.length === 0) summary.push("no structural changes");

  return {
    recordType: after.recordType,
    fromVersion: before?.version ?? null,
    toVersion: after.version,
    stages,
    transitions,
    sla,
    summary,
  };
}

// ---- version storage --------------------------------------------------------

interface VersionRow {
  version: number;
  status: string;
  definition: WorkflowDefinition;
}

async function loadVersions(recordType: string): Promise<VersionRow[]> {
  const rows = await withSystemTx((tx) =>
    tx
      .select({
        version: workflowDefinitions.version,
        status: workflowDefinitions.status,
        definition: workflowDefinitions.definition,
      })
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.recordType, recordType)),
  );
  return rows.map((r) => ({
    version: r.version,
    status: r.status,
    definition: r.definition as WorkflowDefinition,
  }));
}

/** All persisted versions of a record type's workflow (for history / rollback UI). */
export async function listVersions(
  recordType: string,
): Promise<{ version: number; status: string }[]> {
  const rows = await loadVersions(recordType);
  return rows
    .map((r) => ({ version: r.version, status: r.status }))
    .sort((a, b) => a.version - b.version);
}

/**
 * Boot-time hydrate: point the in-memory registry at each type's active version.
 * Tests seed via `defineWorkflow`; production calls this after migrations.
 */
export async function loadActiveWorkflows(): Promise<void> {
  const rows = await withSystemTx((tx) =>
    tx
      .select({ definition: workflowDefinitions.definition })
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.status, "active")),
  );
  for (const r of rows) setActiveDefinition(r.definition as WorkflowDefinition);
}

// ---- publish ----------------------------------------------------------------

/**
 * Apply a workflow config publish: persist an immutable version N+1, retire the
 * prior active version, repoint the in-memory active pointer, and emit
 * `workflow.published`. Reached only through a committed change set (whose approval
 * is `can('changeset.approve')`-gated and whose `config_publish` change is
 * `can('workflow.publish')`-gated). Returns the new version + a human-readable diff.
 */
export async function applyConfigPublish(
  recordType: string,
  rawDefinition: unknown,
): Promise<{ version: number; diff: WorkflowDiff }> {
  requestContext.require();
  const existing = await loadVersions(recordType);
  const tableActive = existing.find((r) => r.status === "active") ?? null;
  // A code-seeded (`defineWorkflow`) active version lives only in memory until the
  // first publish; fold it into version numbering + diff + history.
  const memActive = tryGetWorkflow(recordType) ?? null;
  const baseline = tableActive?.definition ?? memActive;
  const maxVersion = Math.max(
    existing.reduce((m, r) => Math.max(m, r.version), 0),
    memActive?.version ?? 0,
  );
  const version = maxVersion + 1;

  const definition = parseWorkflowDefinition({
    ...(rawDefinition as Record<string, unknown>),
    recordType,
    version,
    status: "active",
  });
  const diff = diffWorkflow(baseline, definition);

  await withSystemTx(async (tx) => {
    if (tableActive) {
      await tx
        .update(workflowDefinitions)
        .set({ status: "retired" })
        .where(
          and(
            eq(workflowDefinitions.recordType, recordType),
            eq(workflowDefinitions.version, tableActive.version),
          ),
        );
    } else if (memActive && !existing.some((r) => r.version === memActive.version)) {
      // Persist the in-memory seed as history so `listVersions` is complete.
      await tx.insert(workflowDefinitions).values({
        recordType,
        version: memActive.version,
        status: "retired",
        definition: memActive,
      });
    }
    await tx.insert(workflowDefinitions).values({ recordType, version, status: "active", definition });
  });

  setActiveDefinition(definition);

  await withTx((tx) =>
    emit(tx, {
      type: "workflow.published",
      subject: { type: "workflow_config", id: recordType },
      payload: {
        recordType,
        fromVersion: tableActive?.version ?? memActive?.version ?? null,
        toVersion: version,
      },
    }),
  );
  await dispatchPending();

  return { version, diff };
}
