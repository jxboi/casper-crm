import { getRecord } from "@casper/records";
import { diffWorkflow, tryGetWorkflow, type WorkflowDefinition } from "@casper/workflow";
import { getChangeSet } from "./changeset.js";
import type { ChangeModel, Risk } from "./types.js";

/**
 * Preview: per-change before/after + an aggregate summary (N touched, risk
 * histogram). Record ops show field-level before/after; `config_publish` delegates
 * to the owning module's `diffWorkflow` for a human-readable config diff. This is
 * the trust surface the P1 success criterion asks for ("human-readable diff").
 */
export interface ChangePreview {
  changeId: string;
  op: string;
  risk: Risk;
  approval: string;
  before: unknown;
  after: unknown;
  /** Config-publish only: the structured, human-readable diff lines. */
  configDiff?: string[];
}

export interface ChangeSetPreview {
  changesetId: string;
  changes: ChangePreview[];
  summary: { totalChanges: number; risk: Record<Risk, number> };
}

export async function previewChangeSet(changesetId: string): Promise<ChangeSetPreview> {
  const cs = await getChangeSet(changesetId);
  const risk: Record<Risk, number> = { low: 0, medium: 0, high: 0 };
  const previews: ChangePreview[] = [];
  for (const c of cs.changes) {
    risk[c.risk] += 1;
    previews.push(await previewChange(c));
  }
  return {
    changesetId,
    changes: previews,
    summary: { totalChanges: cs.changes.length, risk },
  };
}

async function previewChange(c: ChangeModel): Promise<ChangePreview> {
  const common = { changeId: c.id, op: c.op, risk: c.risk, approval: c.approval };
  const t = c.target;

  if (c.op === "config_publish" && t.kind === "config" && t.recordType) {
    const before = tryGetWorkflow(t.recordType) ?? null;
    const after = c.payload as WorkflowDefinition;
    const diff = diffWorkflow(before, after);
    return { ...common, before: before?.version ?? null, after: diff.toVersion, configDiff: diff.summary };
  }

  if (t.kind === "record" && (c.op === "update" || c.op === "delete" || c.op === "transition") && t.id) {
    const rec = await getRecord(t.type, t.id);
    const beforeData = rec?.data ?? null;
    if (c.op === "update") {
      const patch = (c.payload ?? {}) as Record<string, unknown>;
      const before: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) before[k] = (beforeData as Record<string, unknown> | null)?.[k] ?? null;
      return { ...common, before, after: { ...before, ...patch } };
    }
    return { ...common, before: beforeData, after: c.payload };
  }

  // create (and any other): no prior state.
  return { ...common, before: null, after: c.payload };
}
