import { eq } from "drizzle-orm";
import { AppError, requestContext, systemPrincipal, withTx } from "@casper/platform";
import { dispatchPending, emit, withEmissionContext, type EventSource } from "@casper/events";
import { archiveRecord, createRecord, getRecord, updateRecord } from "@casper/records";
import { applyConfigPublish, getActiveVersion, transition } from "@casper/workflow";
import { changes } from "./schema.js";
import { getChangeSet, setStatus } from "./changeset.js";
import type { ChangeModel, Origin } from "./types.js";

/**
 * Commit approved changes **through module write APIs** (never direct table writes,
 * D-006) inside a `withEmissionContext({ causationId: changeset })` scope so every
 * resulting domain event is attributable to the change set. Per-change `applied_at`
 * markers make a crash resumable and partials visible. Conflict pre-check compares
 * each change's `baseVersion` to the live version and blocks (flag stale) on drift —
 * never silently clobbering a concurrent edit.
 */
export async function commitChangeSet(
  changesetId: string,
): Promise<{ appliedChangeIds: string[] }> {
  const cs = await getChangeSet(changesetId);
  if (cs.status !== "approved" && cs.status !== "in_review") {
    throw AppError.invalidState(`cannot commit a '${cs.status}' change set`);
  }
  const approved = cs.changes.filter((c) => c.approval === "approved");
  if (approved.length === 0) throw AppError.invalidState("no approved changes to commit");

  // Conflict pre-check: any drifted change blocks the whole commit.
  for (const change of approved) {
    if (await isStale(change)) {
      await flagStale(changesetId, change.id);
      throw AppError.conflict(
        `change ${change.id} is stale (base version drifted); re-review required`,
        { changeId: change.id },
      );
    }
  }

  await setStatus(changesetId, "committing");

  // Apply under the system principal: the `changeset.approve` gate already
  // authorized these mutations, so commit is a trusted apply path (an AI author
  // couldn't pass per-record `can()` itself — approval is the authorization). The
  // emission context stamps `causationId = changeset` (+ a source reflecting origin)
  // on every resulting event, so the audit chain links back to the change set.
  const appliedChangeIds: string[] = [];
  await requestContext.run(
    { principal: systemPrincipal(cs.orgId, cs.workspaceId), workspaceId: cs.workspaceId },
    () =>
      withEmissionContext({ causationId: changesetId, source: originToSource(cs.origin) }, async () => {
        for (const change of approved) {
          await applyChange(change, cs.author.id);
          await withTx((tx) =>
            tx.update(changes).set({ appliedAt: new Date() }).where(eq(changes.id, change.id)),
          );
          appliedChangeIds.push(change.id);
        }
      }),
  );

  await setStatus(changesetId, "committed");
  const partial = approved.length < cs.changes.length;
  await withTx((tx) =>
    emit(tx, {
      type: partial ? "changeset.partially_approved" : "changeset.committed",
      subject: { type: "changeset", id: changesetId },
      payload: { changesetId, appliedChangeIds },
    }),
  );
  await dispatchPending();
  return { appliedChangeIds };
}

function baseVersionNum(change: ChangeModel): number | undefined {
  return change.baseVersion ? Number(change.baseVersion) : undefined;
}

/** Applied events reflect the change set's origin (D-006 "source reflecting origin"). */
function originToSource(origin: Origin): EventSource | undefined {
  return origin === "ai_run" || origin === "feedback_proposal" ? "ai" : undefined;
}

async function applyChange(change: ChangeModel, authorId: string): Promise<void> {
  const t = change.target;
  switch (change.op) {
    case "create": {
      if (t.kind !== "record") throw AppError.invalidState("create requires a record target");
      // Created records belong to the author, not the system committer.
      await createRecord({
        type: t.type,
        data: (change.payload ?? {}) as Record<string, unknown>,
        ownerId: authorId,
      });
      return;
    }
    case "update": {
      if (t.kind !== "record" || !t.id) throw AppError.invalidState("update requires a record id");
      await updateRecord({
        type: t.type,
        id: t.id,
        patch: (change.payload ?? {}) as Record<string, unknown>,
        baseVersion: baseVersionNum(change),
      });
      return;
    }
    case "delete": {
      if (t.kind !== "record" || !t.id) throw AppError.invalidState("delete requires a record id");
      await archiveRecord({ type: t.type, id: t.id, baseVersion: baseVersionNum(change) });
      return;
    }
    case "transition": {
      if (t.kind !== "record" || !t.id) throw AppError.invalidState("transition requires a record id");
      const toStage = (change.payload as { toStage: string }).toStage;
      await transition({ type: t.type, id: t.id, toStage, baseVersion: baseVersionNum(change) });
      return;
    }
    case "config_publish": {
      if (t.kind !== "config" || !t.recordType) {
        throw AppError.invalidState("config_publish requires a config target with recordType");
      }
      await applyConfigPublish(t.recordType, change.payload);
      return;
    }
  }
}

async function isStale(change: ChangeModel): Promise<boolean> {
  if (change.baseVersion === null) return false;
  const t = change.target;
  if (t.kind === "record" && t.id) {
    const rec = await getRecord(t.type, t.id);
    if (!rec) return true;
    return String(rec.version) !== change.baseVersion;
  }
  if (t.kind === "config" && change.op === "config_publish" && t.recordType) {
    const active = getActiveVersion(t.recordType);
    return active !== undefined && String(active) !== change.baseVersion;
  }
  return false;
}

async function flagStale(changesetId: string, changeId: string): Promise<void> {
  await withTx(async (tx) => {
    await tx
      .update(changes)
      .set({ validation: { ok: false, issues: [{ path: "", message: "stale: base version drifted" }] } })
      .where(eq(changes.id, changeId));
    await emit(tx, {
      type: "change.flagged_stale",
      subject: { type: "changeset", id: changesetId },
      payload: { changesetId, changeId, reason: "base version drifted" },
    });
  });
  await dispatchPending();
}
