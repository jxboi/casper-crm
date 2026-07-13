import { getRecord, type RecordModel } from "@casper/records";
import { getChangeSet } from "./changeset.js";

/**
 * Minimal overlay read (P1b): the live record merged with this change set's own
 * pending `create`/`update` ops — so a preview can render "after" values and a
 * multi-step run can read its own uncommitted state. Not DB branching, and no
 * cross-change-set overlays (both explicitly rejected/deferred in the plan).
 */
export interface OverlayResult {
  data: Record<string, unknown>;
  base: RecordModel | null;
  pending: boolean;
}

export async function readThroughChangeset(
  changesetId: string,
  ref: { type: string; id?: string },
): Promise<OverlayResult> {
  const cs = await getChangeSet(changesetId);
  const base = ref.id ? await getRecord(ref.type, ref.id) : null;
  let data: Record<string, unknown> = base ? { ...base.data } : {};
  let pending = false;

  for (const c of cs.changes) {
    if (c.approval === "rejected") continue;
    const t = c.target;
    if (t.kind !== "record" || t.type !== ref.type) continue;
    if (c.op === "create" && !ref.id) {
      data = { ...(c.payload as Record<string, unknown>) };
      pending = true;
    } else if (c.op === "update" && ref.id && t.id === ref.id) {
      data = { ...data, ...(c.payload as Record<string, unknown>) };
      pending = true;
    }
  }

  return { data, base, pending };
}
