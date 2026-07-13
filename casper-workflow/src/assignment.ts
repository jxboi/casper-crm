import { getRecord, transitionOwner, updateRecord } from "@casper/records";
import type { AssignRule } from "./definition.js";
import { tryGetWorkflow } from "./registry.js";

/**
 * Assignment rules (P1a — simple + declarative). Resolution is pure; execution goes
 * through the records single write path so ownership/field changes stay validated,
 * permission-checked, and event-emitting. `round_robin` is deferred to P1b (it needs
 * live counts and so cannot be resolved purely).
 */

export interface AssignTarget {
  ownerId: string;
  data: Record<string, unknown>;
}

/** Pure: resolve the user id an assignment rule targets, or null if indeterminate. */
export function resolveAssignment(rule: AssignRule, record: AssignTarget): string | null {
  switch (rule.strategy) {
    case "fixed":
      return rule.userId ?? null;
    case "by_field": {
      const v = rule.sourceField ? record.data[rule.sourceField] : undefined;
      return typeof v === "string" ? v : null;
    }
  }
}

/**
 * Impure: apply a resolved assignment via the records write path. `field: "owner"`
 * reassigns ownership (`transitionOwner`); any other field is a user-typed data
 * field written through `updateRecord`.
 */
export async function runAssignment(
  type: string,
  id: string,
  rule: AssignRule,
  record: AssignTarget,
): Promise<void> {
  const target = resolveAssignment(rule, record);
  if (!target) return;
  if (rule.field === "owner") {
    if (record.ownerId === target) return;
    await transitionOwner({ type, id, newOwnerId: target });
  } else {
    await updateRecord({ type, id, patch: { [rule.field]: target } });
  }
}

/**
 * On-create assignment hook. Call from the service layer **after** `createRecord`
 * (casper-api/casper-sales wire this in P1b). It is deliberately *not* an
 * `on('<type>.created')` consumer in P1a: consumers run inside `dispatchPending`'s
 * `withSystemTx`, and calling the write path there would nest transactions and
 * recursively dispatch on PGlite's single connection. The consumer form arrives
 * with the P1b post-commit automation runtime.
 */
export async function onRecordCreated(type: string, id: string): Promise<void> {
  const defn = tryGetWorkflow(type);
  if (!defn?.assignOnCreate) return;
  const rec = await getRecord(type, id);
  if (!rec) return;
  await runAssignment(type, id, defn.assignOnCreate, rec);
}
