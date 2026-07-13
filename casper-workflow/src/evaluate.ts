import { findTransition, type AssignRule, type WorkflowDefinition } from "./definition.js";
import { evaluateFilter, type FilterRecord } from "./filter-eval.js";

/**
 * The architectural core (D-014): `evaluate(definition, record, intent, now) →
 * Effect[]` is a **pure function** — no I/O, no clock reads, no randomness. `now` is
 * a parameter, not a wall-clock read, so the same call replays identically. Effects
 * are *data*; the impure runner (`transition`, `runAssignment`) executes them. This
 * is what makes P3 simulation (collect effects) and shadow mode (log effects) cheap.
 *
 * Permission (`can()`) is intentionally NOT evaluated here — it is async/DB and
 * lives in the impure wrapper. `evaluate` reports which action the wrapper must
 * check via `permission` on an allowed result.
 */

/** A record snapshot — plain data, no DB handle. */
export interface RecordSnapshot extends FilterRecord {
  type: string;
}

export type TransitionIntent = { kind: "transition"; toStage: string };

export type Effect =
  | { kind: "set_stage"; field: string; from: string; to: string }
  | { kind: "set_field"; field: string; value: unknown }
  | { kind: "assign"; rule: AssignRule }
  | { kind: "emit_event"; type: string; payload: Record<string, unknown> };

export interface GuardViolation {
  code: "illegal_transition" | "missing_required_field" | "condition_unmet";
  detail: string;
}

export type EvaluateResult =
  | { status: "allowed"; permission: string; effects: Effect[] }
  | { status: "blocked"; violations: GuardViolation[] };

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function blocked(v: GuardViolation): EvaluateResult {
  return { status: "blocked", violations: [v] };
}

export function evaluate(
  defn: WorkflowDefinition,
  record: RecordSnapshot,
  intent: TransitionIntent,
  now: Date,
): EvaluateResult {
  const from = String(record.data[defn.stageField] ?? defn.initialStage);
  const to = intent.toStage;

  // 1. Target stage must exist.
  if (!defn.stages.some((s) => s.key === to)) {
    return blocked({ code: "illegal_transition", detail: `unknown stage '${to}'` });
  }

  // 2. A legal transition must connect from → to.
  const t = findTransition(defn, from, to);
  if (!t) {
    return blocked({ code: "illegal_transition", detail: `no transition '${from}' → '${to}'` });
  }

  // 3. Required-fields guard — present and non-empty.
  const missing = t.guard.requiredFields.filter((f) => isEmpty(record.data[f]));
  if (missing.length > 0) {
    return blocked({
      code: "missing_required_field",
      detail: `missing required field(s): ${missing.join(", ")}`,
    });
  }

  // 4. Condition guard — Filter AST evaluated in-memory against the record + `now`.
  if (t.guard.condition && !evaluateFilter(t.guard.condition, record, now)) {
    return blocked({ code: "condition_unmet", detail: "transition condition not met" });
  }

  // 5. Effects (data only). The wrapper persists these via the records write path.
  const effects: Effect[] = [
    { kind: "set_stage", field: defn.stageField, from, to },
    { kind: "set_field", field: defn.stageEnteredAtField, value: now.toISOString() },
  ];
  if (t.assign) effects.push({ kind: "assign", rule: t.assign });

  return { status: "allowed", permission: t.guard.permission, effects };
}
