import { asc, eq } from "drizzle-orm";
import {
  newId,
  now,
  requestContext,
  systemPrincipal,
  withSystemTx,
  withTx,
  type Tx,
} from "@casper/platform";
import {
  dispatchPending,
  emit,
  on,
  withEmissionContext,
  schema as eventsSchema,
  type Consumer,
  type DomainEvent,
} from "@casper/events";
import {
  createRecord,
  tryGetRecordType,
  updateRecord,
  schema as recordsSchema,
} from "@casper/records";
import { automationRuns } from "./schema.js";
import { getAutomation, listAutomationsForEvent } from "./automation-registry.js";
import { evaluateAutomation } from "./evaluate-automation.js";
import { type FilterRecord } from "./filter-eval.js";
import { transition } from "./transition.js";
import type { Action, AutomationDefinition } from "./automation-definition.js";

/**
 * The automation runtime (D-014/D-026). Two halves, split to respect the dispatch
 * transaction: the **consumer** only *enqueues* pending runs (a plain insert on the
 * dispatch tx — never a nested write path), and a **post-commit driver** drains and
 * executes them through module APIs under the system principal.
 *
 * Loop protection: each event carries `causationId`; the consumer computes the
 * causation-chain **depth** and, at/above `MAX_DEPTH`, records a `blocked` run
 * instead of a `pending` one — so a self-triggering rule terminates with a bounded,
 * visible run log. At-least-once dispatch is absorbed by the unique
 * (automation_id, trigger_event_id) on the run log.
 */
const MAX_DEPTH = 5;

type AutomationRunRow = typeof automationRuns.$inferSelect;

// ---- consumer (enqueue only) ------------------------------------------------

const automationConsumer: Consumer = async (event, tx) => {
  const matches = listAutomationsForEvent(event.type);
  if (matches.length === 0) return;

  const depth = await chainDepth(tx, event.causationId);
  // Evaluate the condition here, at the moment of the event, against the record's
  // state right after the triggering write — using the event's own timestamp as
  // `now`. This is deterministic and, unlike evaluating at drain time, distinguishes
  // successive events on the same record (e.g. →qualified then →won).
  const snapshot = await loadSnapshotTx(tx, event.subject.type, event.subject.id);
  const eventNow = new Date(event.occurredAt);

  for (const defn of matches) {
    let status = "pending";
    let conditionResult: boolean | null = null;
    if (depth >= MAX_DEPTH) {
      status = "blocked";
    } else {
      conditionResult = evaluateAutomation(defn, snapshot, eventNow).conditionMet;
      status = conditionResult ? "pending" : "skipped";
    }
    await tx
      .insert(automationRuns)
      .values({
        id: newId(),
        orgId: event.orgId,
        workspaceId: event.workspaceId,
        automationId: defn.id,
        triggerEventId: event.id,
        recordType: event.subject.type,
        recordId: event.subject.id,
        status,
        depth,
        conditionResult,
      })
      .onConflictDoNothing();
  }
};

/** Read a record snapshot via the *dispatch* tx (no nested write path). */
async function loadSnapshotTx(
  tx: Tx,
  type: string,
  id: string,
): Promise<FilterRecord | null> {
  // Guard: only record-typed subjects are loadable (config subjects aren't records,
  // and their non-uuid ids would not match the uuid `records.id` column).
  if (!tryGetRecordType(type)) return null;
  const rows = await tx
    .select({
      id: recordsSchema.records.id,
      ownerId: recordsSchema.records.ownerId,
      data: recordsSchema.records.data,
      createdAt: recordsSchema.records.createdAt,
      updatedAt: recordsSchema.records.updatedAt,
      lastActivityAt: recordsSchema.records.lastActivityAt,
    })
    .from(recordsSchema.records)
    .where(eq(recordsSchema.records.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    ownerId: r.ownerId,
    data: (r.data ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt?.toISOString() ?? null,
    updatedAt: r.updatedAt?.toISOString() ?? null,
    lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
  };
};

/** Length of the causation chain behind an event (loop-protection signal). */
async function chainDepth(tx: Tx, causationId: string | undefined): Promise<number> {
  let depth = 0;
  let cur = causationId;
  while (cur && depth <= MAX_DEPTH + 1) {
    const rows = await tx
      .select({ c: eventsSchema.domainEvents.causationId })
      .from(eventsSchema.domainEvents)
      .where(eq(eventsSchema.domainEvents.id, cur))
      .limit(1);
    const row = rows[0];
    if (!row) break;
    depth += 1;
    cur = row.c ?? undefined;
  }
  return depth;
}

/** Register the automation consumer. Idempotent (named). Called at module wiring. */
export function registerAutomationConsumer(): void {
  on("*", automationConsumer, "workflow:automation");
}

// ---- driver (post-commit) ---------------------------------------------------

/**
 * Drain pending automation runs, executing their actions through module write APIs.
 * Call after the triggering write (a request `waitUntil` / sweeper cron in prod;
 * explicit in tests). Actions emit events → dispatch enqueues child runs → drained
 * next pass; the depth cap guarantees termination. Returns the number of runs
 * processed.
 */
export async function runPendingAutomations(): Promise<number> {
  let processed = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const pending = await withSystemTx((tx) =>
      tx
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.status, "pending"))
        .orderBy(asc(automationRuns.depth), asc(automationRuns.createdAt))
        .limit(50),
    );
    if (pending.length === 0) break;
    for (const run of pending) {
      await executeRun(run);
      processed += 1;
    }
  }
  return processed;
}

async function executeRun(run: AutomationRunRow): Promise<void> {
  await setRun(run.id, { status: "running", startedAt: now() });
  const defn = getAutomation(run.automationId);
  if (!defn) {
    await setRun(run.id, { status: "failed", error: "automation not found", finishedAt: now() });
    return;
  }

  // The condition was already evaluated (and passed) at enqueue time, so the driver
  // just executes the actions through module write APIs under the system principal.
  await requestContext.run(
    { principal: systemPrincipal(run.orgId, run.workspaceId), workspaceId: run.workspaceId },
    async () => {
      try {
        await withEmissionContext({ causationId: run.triggerEventId, source: "automation" }, async () => {
          for (const action of defn.actions) await executeAction(action, run, defn);
        });
        await setRun(run.id, { status: "executed", effects: defn.actions, finishedAt: now() });
        await emitRunOutcome("automation.executed", run, defn, defn.actions.length);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await setRun(run.id, { status: "failed", error: message, finishedAt: now() });
        await emitRunOutcome("automation.failed", run, defn, defn.actions.length);
      }
    },
  );
}

async function executeAction(
  action: Action,
  run: AutomationRunRow,
  defn: AutomationDefinition,
): Promise<void> {
  switch (action.kind) {
    case "create_task": {
      const data: Record<string, unknown> = {
        title: action.title,
        priority: action.priority ?? "medium",
        status: "open",
        source: "automation",
      };
      if (action.assignee) data.assignee = action.assignee;
      if (action.relateToTrigger && run.recordType && run.recordId) {
        data.relatedTo = { type: run.recordType, id: run.recordId };
      }
      await createRecord({ type: "task", data });
      return;
    }
    case "update_field": {
      if (run.recordType && run.recordId) {
        await updateRecord({ type: run.recordType, id: run.recordId, patch: { [action.field]: action.value } });
      }
      return;
    }
    case "transition": {
      if (run.recordType && run.recordId) {
        await transition({ type: run.recordType, id: run.recordId, toStage: action.toStage });
      }
      return;
    }
    case "notify": {
      await withTx((tx) =>
        emit(tx, {
          type: "notification.requested",
          subject: { type: run.recordType ?? "automation", id: run.recordId ?? defn.id },
          payload: {
            automationId: defn.id,
            channel: action.channel,
            to: action.to,
            message: action.message,
          },
        }),
      );
      await dispatchPending();
      return;
    }
  }
}

async function emitRunOutcome(
  type: "automation.executed" | "automation.failed",
  run: AutomationRunRow,
  defn: AutomationDefinition,
  actions: number,
): Promise<void> {
  await withTx((tx) =>
    emit(tx, {
      type,
      subject: { type: run.recordType ?? "automation", id: run.recordId ?? defn.id },
      payload: {
        automationId: defn.id,
        triggerEventId: run.triggerEventId,
        recordId: run.recordId,
        actions,
        depth: run.depth,
      },
    }),
  );
  await dispatchPending();
}

async function setRun(id: string, fields: Partial<AutomationRunRow>): Promise<void> {
  await withSystemTx((tx) => tx.update(automationRuns).set(fields).where(eq(automationRuns.id, id)));
}

/** Read the run log for a record (test/introspection helper). */
export async function getAutomationRuns(filter?: {
  automationId?: string;
}): Promise<AutomationRunRow[]> {
  return withSystemTx((tx) => {
    const q = tx.select().from(automationRuns).orderBy(asc(automationRuns.createdAt));
    return filter?.automationId
      ? q.where(eq(automationRuns.automationId, filter.automationId))
      : q;
  });
}

export type { DomainEvent };
