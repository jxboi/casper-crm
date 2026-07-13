import { AppError, now, requestContext, withTx } from "@casper/platform";
import { assertCan } from "@casper/auth";
import { dispatchPending, emit } from "@casper/events";
import { getRecord, updateRecord, type RecordModel } from "@casper/records";
import { getWorkflow } from "./registry.js";
import { evaluate, type RecordSnapshot } from "./evaluate.js";
import { runAssignment } from "./assignment.js";

/**
 * `transition()` — the **only** way a record's stage changes (UI drag, AI proposal
 * commit, and P1b automations all funnel through here). It composes:
 *   pure evaluate() (legality + guards) → can() → persist via records → stage_changed.
 *
 * Persistence goes through the records single write path (`updateRecord`), which is
 * the sole mutator of `records.data`; the semantic `<type>.stage_changed` is emitted
 * as an additional event afterward (see the note below).
 */
export interface TransitionInput {
  type: string;
  id: string;
  toStage: string;
  /** Optimistic-concurrency token passed through to `updateRecord`. */
  baseVersion?: number;
}

function toSnapshot(rec: RecordModel): RecordSnapshot {
  return {
    id: rec.id,
    type: rec.type,
    ownerId: rec.ownerId,
    data: rec.data,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    lastActivityAt: rec.lastActivityAt,
  };
}

export async function transition(input: TransitionInput): Promise<RecordModel> {
  const ctx = requestContext.require();
  const defn = getWorkflow(input.type);

  const rec = await getRecord(input.type, input.id);
  if (!rec) throw AppError.notFound(`record ${input.type}/${input.id} not found`);

  const snapshot = toSnapshot(rec);
  const result = evaluate(defn, snapshot, { kind: "transition", toStage: input.toStage }, now());

  if (result.status === "blocked") {
    const v = result.violations[0]!;
    // Missing required fields mirror records' validation taxonomy; the rest are
    // illegal state transitions / unmet conditions.
    if (v.code === "missing_required_field") throw AppError.validation(v.detail, result.violations);
    throw AppError.invalidState(v.detail, result.violations);
  }

  // Permission is impure (async/DB), so it stays out of evaluate(). Persistence via
  // updateRecord additionally needs record.update at the same scope — every role that
  // grants record.transition grants record.update likewise, so one check suffices.
  await assertCan(
    ctx.principal,
    result.permission,
    { kind: "record", type: input.type, id: input.id, ownerId: rec.ownerId, workspaceId: ctx.workspaceId },
    { workspaceId: ctx.workspaceId },
  );

  // Effects → a single patch on the records write path.
  const patch: Record<string, unknown> = {};
  let from = "";
  for (const e of result.effects) {
    if (e.kind === "set_stage") {
      patch[e.field] = e.to;
      from = e.from;
    } else if (e.kind === "set_field") {
      patch[e.field] = e.value;
    }
  }

  const updated = await updateRecord({
    type: input.type,
    id: input.id,
    patch,
    baseVersion: input.baseVersion,
  });

  // Semantic event. records/write.ts is the sole mutator of records.data, so the
  // stage change is persisted there and announced here in a second tx (sharing the
  // request correlationId). A P1b write-path hook makes the two atomic.
  await withTx((tx) =>
    emit(tx, {
      type: `${input.type}.stage_changed`,
      subject: { type: input.type, id: input.id },
      payload: { from, to: input.toStage, workflowVersion: defn.version },
    }),
  );
  await dispatchPending();

  // On-transition assignment, if the matched transition carried one.
  const assign = result.effects.find((e) => e.kind === "assign");
  if (assign && assign.kind === "assign") {
    await runAssignment(input.type, input.id, assign.rule, snapshot);
    const fresh = await getRecord(input.type, input.id);
    if (fresh) return fresh;
  }

  return updated;
}
