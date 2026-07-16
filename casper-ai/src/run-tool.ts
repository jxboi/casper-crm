import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { isAppError, withTx } from "@casper/platform";
import { assertCan, type ResourceRef } from "@casper/auth";
import { dispatchPending, emit } from "@casper/events";
import { M1_TOOLS } from "./tools.js";
import { appendStep } from "./steps.js";
import type { ActionClass, AssistantDef, Policy, ToolContext, ToolDef } from "./types.js";

/**
 * The tool framework's single entry point. Every tool call the model makes passes
 * through here, in this order (master-plan §6):
 *   allowlist → tenant scope (implicit via the run's request context + RLS) →
 *   policy matrix → can() for the assistant principal → execute → log the step.
 * A denial emits `ai.tool_denied` (a trust metric) and returns an error outcome the
 * run feeds back to the model as an `is_error` tool_result — it never throws into
 * the loop. This is where the "assistant cannot act outside its scope" guarantee
 * lives; the propose tools additionally have no code path to a live record.
 */
export type ToolOutcome = { ok: true; output: unknown } | { ok: false; error: string };

/** Reads ride the open-read access model (D-020) + RLS; only proposals need a write gate. */
function permissionFor(tool: ToolDef, input: unknown): { action: string; resource: ResourceRef } | null {
  const i = input as Record<string, unknown>;
  switch (tool.actionClass) {
    case "propose_task":
      return { action: "record.create", resource: { kind: "record", type: "task" } };
    case "propose_field":
      return { action: "record.update", resource: { kind: "record", type: String(i.type), id: String(i.id) } };
    case "propose_transition":
      return { action: "record.transition", resource: { kind: "record", type: String(i.type), id: String(i.id) } };
    default:
      return null; // read / artifact / config_publish (the last is gated inside addChange)
  }
}

async function denyEvent(ctx: ToolContext, tool: string, reason: string): Promise<void> {
  await withTx((tx) =>
    emit(tx, { type: "ai.tool_denied", subject: { type: "ai_run", id: ctx.runId }, payload: { runId: ctx.runId, tool, reason } }),
  );
  await dispatchPending();
}

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const tool = M1_TOOLS[name];
  if (!tool || !ctx.assistant.toolAllowlist.includes(name)) {
    await denyEvent(ctx, name, "not in the assistant's tool allowlist");
    return { ok: false, error: `tool '${name}' is not available to this assistant` };
  }

  const policy: Policy = ctx.assistant.policyMatrix[tool.actionClass as ActionClass] ?? "always_allow";
  if (policy === "never") {
    await denyEvent(ctx, name, `policy '${tool.actionClass}' = never`);
    return { ok: false, error: `action '${tool.actionClass}' is never permitted for this assistant` };
  }

  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: `invalid input: ${parsed.error.issues.map((x) => x.message).join("; ")}` };
  }

  const perm = permissionFor(tool, parsed.data);
  if (perm) {
    // D-022: authorize against the owner, not the assistant. The assistant is the
    // actor (attribution, reads), but it can only propose what its owner may do.
    try {
      await assertCan(ctx.owner, perm.action, perm.resource, { workspaceId: ctx.owner.workspaceId });
    } catch (err) {
      const reason = isAppError(err) ? err.message : "permission denied";
      await denyEvent(ctx, name, reason);
      return { ok: false, error: reason };
    }
  }

  try {
    const output = await tool.run(parsed.data, ctx);
    await appendStep(ctx.runId, "tool_call", { name, input: parsed.data, output });
    return { ok: true, output };
  } catch (err) {
    const message = isAppError(err) ? err.message : String(err);
    await appendStep(ctx.runId, "tool_call", { name, input: parsed.data, error: message });
    return { ok: false, error: message };
  }
}

/** Build the Anthropic tool list for a run from the assistant's allowlist (zod → JSON Schema). */
export function toAnthropicTools(assistant: AssistantDef): Anthropic.Tool[] {
  return assistant.toolAllowlist
    .map((name) => M1_TOOLS[name])
    .filter((t): t is ToolDef => Boolean(t))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: zodToJsonSchema(tool.inputSchema, { target: "openApi3" }) as Anthropic.Tool["input_schema"],
    }));
}
