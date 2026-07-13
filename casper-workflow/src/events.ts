import { z } from "zod";
import { registerEventTypes } from "@casper/events";

/**
 * Workflow event contracts. Registering zod payload schemas makes `emit` validate
 * these types in dev/test (the emitter checks a schema only when one is registered),
 * keeping the workflow stream well-typed. `registerWorkflowModule` calls
 * `registerWorkflowEventTypes` once at boot; `defineWorkflow` additionally registers
 * the per-type `<recordType>.stage_changed` schema.
 */

export const stageChangedSchema = z.object({
  from: z.string(),
  to: z.string(),
  workflowVersion: z.number().int(),
});

/** SLA / staleness breach payload — emitted by the scheduled scan. */
export const slaBreachSchema = z.object({
  rule: z.string(),
  kind: z.enum(["inactivity", "stage_age"]),
  stage: z.string().nullable(),
  breachedAt: z.string(),
});

/** Config publish / rollback — a workflow version became active. */
export const workflowPublishedSchema = z.object({
  recordType: z.string(),
  fromVersion: z.number().int().nullable(),
  toVersion: z.number().int(),
});

/** Automation run outcome (run-log projection of the automation runtime). */
export const automationRunSchema = z.object({
  automationId: z.string(),
  triggerEventId: z.string(),
  recordId: z.string().nullable(),
  actions: z.number().int(),
  depth: z.number().int(),
});

/** The `notify` action — no notification subsystem exists yet; forward-compatible. */
export const notificationRequestedSchema = z.object({
  automationId: z.string().optional(),
  channel: z.string(),
  to: z.string().optional(),
  message: z.string(),
});

export function registerWorkflowEventTypes(): void {
  registerEventTypes({
    "workflow.sla_breached": slaBreachSchema,
    "record.neglected": slaBreachSchema,
    "workflow.published": workflowPublishedSchema,
    "workflow.rolled_back": workflowPublishedSchema,
    "automation.executed": automationRunSchema,
    "automation.failed": automationRunSchema,
    "notification.requested": notificationRequestedSchema,
  });
}

/** Register the semantic `<recordType>.stage_changed` payload schema. */
export function registerStageChangedType(recordType: string): void {
  registerEventTypes({ [`${recordType}.stage_changed`]: stageChangedSchema });
}
