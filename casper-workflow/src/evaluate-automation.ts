import type { AutomationDefinition, Action } from "./automation-definition.js";
import { evaluateFilter, type FilterRecord } from "./filter-eval.js";

/**
 * Pure automation evaluation — mirrors the `evaluate()` purity contract (D-014):
 * no I/O, no clock read (`now` is a parameter), no randomness. Given a matched
 * automation, the trigger event, the current record snapshot, and `now`, it returns
 * whether the condition holds and the actions to run. The impure runtime executes
 * the actions post-commit.
 *
 * P1b conditions are evaluated over the record snapshot (the common case — e.g.
 * `stage == 'won'` after a `stage_changed`). Event-payload conditions are a P2
 * extension of the resolve surface.
 */
export interface AutomationEvalResult {
  conditionMet: boolean;
  actions: Action[];
}

export function evaluateAutomation(
  defn: AutomationDefinition,
  record: FilterRecord | null,
  now: Date,
): AutomationEvalResult {
  if (defn.condition) {
    if (!record || !evaluateFilter(defn.condition, record, now)) {
      return { conditionMet: false, actions: [] };
    }
  }
  return { conditionMet: true, actions: defn.actions };
}
