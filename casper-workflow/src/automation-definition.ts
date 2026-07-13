import { z } from "zod";
import { filterSchema } from "./definition.js";

/**
 * Automation definitions (config-as-data). A trigger (domain-event pattern) + an
 * optional condition (Filter AST over the record) + a list of actions. The `Action`
 * vocabulary is intentionally separate from the stage-machine `Effect` union: these
 * are the P1b automation actions, executed by the runtime through module write APIs.
 */
export const actionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_task"),
    title: z.string(),
    assignee: z.string().optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    /** Relate the task to the record the trigger event is about (default true). */
    relateToTrigger: z.boolean().default(true),
  }),
  z.object({ kind: z.literal("update_field"), field: z.string(), value: z.unknown() }),
  z.object({ kind: z.literal("transition"), toStage: z.string() }),
  z.object({
    kind: z.literal("notify"),
    channel: z.string().default("inapp"),
    to: z.string().optional(),
    message: z.string(),
  }),
]);
export type Action = z.infer<typeof actionSchema>;

export const automationDefinitionSchema = z.object({
  id: z.string(),
  version: z.number().int().default(1),
  /** Optional record-type scope (advisory; the trigger pattern is authoritative). */
  recordType: z.string().optional(),
  /** Domain-event type pattern: exact, `prefix.*`, or `*`. */
  trigger: z.string(),
  /** Filter AST over the record snapshot (+ now). Absent = always fires. */
  condition: filterSchema.optional(),
  actions: z.array(actionSchema),
  enabled: z.boolean().default(true),
});
export type AutomationDefinition = z.infer<typeof automationDefinitionSchema>;

export function parseAutomationDefinition(raw: unknown): AutomationDefinition {
  return automationDefinitionSchema.parse(raw);
}
