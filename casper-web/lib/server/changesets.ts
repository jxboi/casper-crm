"use server";

import { isAppError } from "@casper/platform";
import { listRecords } from "@casper/records";
import {
  addChange,
  approveAll,
  approveChange,
  commitChangeSet,
  createChangeSet,
  getChangeSet,
  listChangeSets,
  previewChangeSet,
  rejectChange,
  submitForReview,
} from "@casper/changesets";
import type { ChangeSet as WebChangeSet } from "@/lib/types";
import { toWebChangeSet } from "./map";
import { withEngine } from "./context";

/**
 * The approval-flow BFF (D-006). Unlike the earlier `commitFollowups` shim — which
 * wrote records directly — these Server Functions drive the **real** `casper-changesets`
 * module: the assistant run stages a draft change set, the inbox/dock approve or reject
 * individual changes, and commit applies the approved subset **through the records write
 * path** under the system principal, stamping `causationId = changeset` on every event.
 * Nothing touches a record until commit — the safety property is now structural, not
 * narrated. All types are mapped to the web view shapes by `toWebChangeSet`.
 */

/** A deal-id → name lookup, so change rows can name their deal. */
async function dealNameResolver(): Promise<(id: string) => string> {
  const deals = await listRecords({ type: "deal", limit: 500 });
  const names = new Map(deals.records.map((r) => [r.id, String(r.data.name ?? "")]));
  return (id: string) => names.get(id) ?? "—";
}

/** Map an engine change set (by id) to the web view type, with its before/after preview. */
async function mapSet(id: string, dealName: (id: string) => string): Promise<WebChangeSet> {
  const [cs, preview] = await Promise.all([getChangeSet(id), previewChangeSet(id)]);
  return toWebChangeSet(cs, preview, dealName);
}

export interface FollowupInput {
  dealId: string;
  taskTitle: string;
  dueDate: string;
  nextActionDate: string;
}

/**
 * Stage the assistant run's follow-ups as a real, in-review change set: per deal a
 * task-create and a next-action-date update. Returns the mapped set for the dock +
 * inbox. Email drafts are workspace artifacts (no record op), so they are not part of
 * the change set — the caller keeps them client-side for the Workspace tab.
 */
export async function prepareFollowups(inputs: FollowupInput[]): Promise<WebChangeSet> {
  return withEngine(async () => {
    const n = inputs.length;
    const cs = await createChangeSet({
      title: `Follow-ups for ${n} neglected deal${n === 1 ? "" : "s"}`,
      intent: "Prepare follow-ups for my neglected deals",
      origin: "ai_run",
    });
    for (const input of inputs) {
      await addChange(cs.id, {
        op: "create",
        target: { kind: "record", type: "task" },
        payload: {
          title: input.taskTitle,
          due: input.dueDate,
          status: "open",
          source: "ai",
          relatedTo: { type: "deal", id: input.dealId },
        },
      });
      await addChange(cs.id, {
        op: "update",
        target: { kind: "record", type: "deal", id: input.dealId },
        payload: { nextActionDate: input.nextActionDate },
      });
    }
    // Leave draft → in_review so the inbox/dock can review it.
    await submitForReview(cs.id);
    return mapSet(cs.id, await dealNameResolver());
  });
}

/** Every change set in the workspace, newest first — the Approvals inbox feed. */
export async function listWebChangeSets(): Promise<WebChangeSet[]> {
  return withEngine(async () => {
    const [sets, dealName] = await Promise.all([listChangeSets(), dealNameResolver()]);
    return Promise.all(sets.map((cs) => mapSet(cs.id, dealName)));
  });
}

/** A single change set, mapped — used by the dock and by post-mutation refetches. */
export async function getWebChangeSet(id: string): Promise<WebChangeSet | null> {
  return withEngine(async () => {
    try {
      return await mapSet(id, await dealNameResolver());
    } catch (e) {
      if (isAppError(e) && e.code === "not_found") return null;
      throw e;
    }
  });
}

export async function approveChangeAction(csId: string, changeId: string): Promise<WebChangeSet> {
  return withEngine(async () => {
    await approveChange(csId, changeId);
    return mapSet(csId, await dealNameResolver());
  });
}

export async function rejectChangeAction(csId: string, changeId: string): Promise<WebChangeSet> {
  return withEngine(async () => {
    await rejectChange(csId, changeId);
    return mapSet(csId, await dealNameResolver());
  });
}

export async function approveAllAction(csId: string): Promise<WebChangeSet> {
  return withEngine(async () => {
    await approveAll(csId);
    return mapSet(csId, await dealNameResolver());
  });
}

/** Reject every still-pending change (the module has approveAll but no rejectAll). */
export async function rejectAllAction(csId: string): Promise<WebChangeSet> {
  return withEngine(async () => {
    const cs = await getChangeSet(csId);
    for (const c of cs.changes) {
      if (c.approval === "pending") await rejectChange(csId, c.id);
    }
    return mapSet(csId, await dealNameResolver());
  });
}

/** Count of change sets still awaiting review or commit — the nav badge. */
export async function countPendingApprovals(): Promise<number> {
  return withEngine(async () => {
    const sets = await listChangeSets({ status: ["in_review", "approved"] });
    return sets.length;
  });
}

export interface CommitChangeSetResult {
  ok: boolean;
  issues: string[];
  changeSet: WebChangeSet;
}

/**
 * Commit the approved subset through the engine. A stale base version (`conflict`) or
 * an already-decided/empty set (`invalid_state`) comes back as a human-readable issue,
 * with the refreshed set (its stale change now flagged) so the UI can re-review rather
 * than silently clobbering a concurrent edit.
 */
export async function commitChangeSetAction(csId: string): Promise<CommitChangeSetResult> {
  return withEngine(async () => {
    const dealName = await dealNameResolver();
    try {
      await commitChangeSet(csId);
      return { ok: true, issues: [], changeSet: await mapSet(csId, dealName) };
    } catch (e) {
      const message = isAppError(e) ? e.message : e instanceof Error ? e.message : String(e);
      return { ok: false, issues: [message], changeSet: await mapSet(csId, dealName) };
    }
  });
}
