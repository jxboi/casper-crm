import { z } from "zod";
import type { Filter } from "@casper/records";

/**
 * Workflow definitions as config-as-data (D-006, D-014). Everything here is a plain
 * JSON object validated by zod — so the same shapes later feed change-set diffs,
 * AI-generated proposals, and versioned storage without code deploys. The engine
 * (`evaluate`) is pure over these definitions; nothing here reads I/O or the clock.
 */

/** Duration mirrors the records Filter `Duration` ({ amount, unit }). */
export const durationSchema = z.object({
  amount: z.number(),
  unit: z.enum(["minute", "hour", "day", "week", "month"]),
});

/**
 * A zod mirror of the records `Filter` AST, used to validate a stored condition.
 * The interpreter (`filter-eval.ts`) — not zod — enforces operator semantics, so
 * `op` stays a string here and unknown operators surface at evaluation time,
 * exactly as `compileFilter` rejects them at SQL-compile time.
 */
export const filterSchema: z.ZodType<Filter> = z.lazy(() =>
  z.union([
    z.object({ field: z.string(), op: z.string(), value: z.unknown().optional() }),
    z.object({ and: z.array(filterSchema) }),
    z.object({ or: z.array(filterSchema) }),
    z.object({ not: filterSchema }),
  ]),
) as z.ZodType<Filter>;

export const stageSchema = z.object({
  key: z.string(),
  name: z.string(),
  category: z.enum(["open", "won", "lost", "closed"]),
  color: z.string().optional(),
  order: z.number().int(),
});
export type Stage = z.infer<typeof stageSchema>;

export const guardSchema = z.object({
  /** Field keys that must be present and non-empty on the record to transition. */
  requiredFields: z.array(z.string()).default([]),
  /** Filter AST evaluated in-memory against the record (+ `now`). */
  condition: filterSchema.optional(),
  /** Action checked via `can()` in the impure wrapper (default `record.transition`). */
  permission: z.string().default("record.transition"),
});
export type Guard = z.infer<typeof guardSchema>;

/**
 * Simple, declarative assignment (P1a). `round_robin` is deferred to P1b — it needs
 * live counts and so cannot be resolved purely.
 */
export const assignRuleSchema = z.object({
  strategy: z.enum(["fixed", "by_field"]),
  /** Target field; `"owner"` reassigns ownership, otherwise a user-typed data field. */
  field: z.string().default("owner"),
  /** For `fixed`: the user id to assign. */
  userId: z.string().optional(),
  /** For `by_field`: the data field whose value is the user id to assign. */
  sourceField: z.string().optional(),
});
export type AssignRule = z.infer<typeof assignRuleSchema>;

export const transitionSchema = z.object({
  /** Source stage key, or `"*"` to allow the transition from any stage. */
  from: z.string(),
  to: z.string(),
  guard: guardSchema.default({}),
  /** Optional on-transition assignment. */
  assign: assignRuleSchema.optional(),
});
export type TransitionDef = z.infer<typeof transitionSchema>;

export const slaRuleSchema = z.object({
  key: z.string(),
  kind: z.enum(["inactivity", "stage_age"]),
  /** Optional stage scope. Required in practice for `stage_age`. */
  stage: z.string().optional(),
  threshold: durationSchema,
  /** Which event to emit on breach. */
  event: z
    .enum(["workflow.sla_breached", "record.neglected"])
    .default("workflow.sla_breached"),
});
export type SlaRule = z.infer<typeof slaRuleSchema>;

export const workflowDefinitionSchema = z.object({
  recordType: z.string(),
  version: z.number().int(),
  status: z.enum(["draft", "active", "retired"]).default("active"),
  initialStage: z.string(),
  /** Where the stage value lives in `records.data` (P1a keeps it in JSONB). */
  stageField: z.string().default("stage"),
  /** Datetime field stamped with the moment the record entered its current stage. */
  stageEnteredAtField: z.string().default("stageEnteredAt"),
  stages: z.array(stageSchema),
  transitions: z.array(transitionSchema),
  /** Assignment applied when a record of this type is created. */
  assignOnCreate: assignRuleSchema.optional(),
  sla: z.array(slaRuleSchema).default([]),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/** Parse + validate raw config into a `WorkflowDefinition` (throws zod errors). */
export function parseWorkflowDefinition(raw: unknown): WorkflowDefinition {
  return workflowDefinitionSchema.parse(raw);
}

/**
 * The one legal transition from `from` → `to`, or undefined. A transition with
 * `from: "*"` matches any source stage. Explicit `from` matches win over wildcard.
 */
export function findTransition(
  defn: WorkflowDefinition,
  from: string,
  to: string,
): TransitionDef | undefined {
  return (
    defn.transitions.find((t) => t.from === from && t.to === to) ??
    defn.transitions.find((t) => t.from === "*" && t.to === to)
  );
}
