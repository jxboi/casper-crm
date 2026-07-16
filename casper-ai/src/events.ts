import { z } from "zod";
import { registerEventTypes } from "@casper/events";

/**
 * Assistant-run lifecycle events. These land in the audit log alongside the
 * domain events a committed run produces (which carry `causationId = changeset`,
 * stamped by casper-changesets at commit). `ai.tool_denied` is a trust-metric
 * input (permission/risk refusals). Loose payloads for P1b, tightened as the UX
 * firms up — same convention as casper-changesets/events.ts.
 */
const runLifecycleSchema = z.object({
  runId: z.string(),
  assistantKey: z.string().optional(),
  changesetId: z.string().optional(),
  status: z.string().optional(),
  error: z.string().optional(),
});

const toolDeniedSchema = z.object({
  runId: z.string(),
  tool: z.string(),
  reason: z.string(),
});

const budgetSchema = z.object({
  runId: z.string().optional(),
  assistantKey: z.string(),
  limit: z.string(),
});

export function registerAiEventTypes(): void {
  registerEventTypes({
    "ai.run_started": runLifecycleSchema,
    "ai.plan_ready": runLifecycleSchema,
    "ai.preview_ready": runLifecycleSchema,
    "ai.run_committed": runLifecycleSchema,
    "ai.run_failed": runLifecycleSchema,
    "ai.run_cancelled": runLifecycleSchema,
    "ai.budget_exceeded": budgetSchema,
    "ai.tool_denied": toolDeniedSchema,
  });
}
