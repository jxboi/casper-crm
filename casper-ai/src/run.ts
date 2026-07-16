import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { newId, requestContext, withTx, isAppError, type Principal } from "@casper/platform";
import { emit, dispatchPending } from "@casper/events";
import { createChangeSet, getChangeSet } from "@casper/changesets";
import { getAssistant } from "./registry.js";
import { composeSystemPrompt, modelForTier, modelTurn, PROMPT_VERSION } from "./gateway.js";
import { runTool, toAnthropicTools } from "./run-tool.js";
import { appendStep } from "./steps.js";
import { aiRuns } from "./schema.js";
import type { AssistantDef, EmailDraftArtifact, RunEvent, RunModel, RunPlan, RunStatus, ToolContext } from "./types.js";

function asEmailDraft(output: unknown): EmailDraftArtifact | null {
  return output && typeof output === "object" && (output as { kind?: string }).kind === "email_draft"
    ? (output as EmailDraftArtifact)
    : null;
}

/**
 * The run engine — the standard work cycle for the P1b slice (D-009): the run
 * executes under the *assistant* principal (so `can()`, the change-set author, and
 * record reads are all the assistant's), drives a model/tool loop, and ends at
 * `preview_ready` — a draft change set submitted for review. Approval and commit
 * stay a human action in casper-changesets, so there is no path here from model
 * output to a committed write. Clarifying / plan-approval suspensions and WDK
 * durability arrive in P1c (see plan.md).
 */

const MAX_ITERATIONS = 12;

export interface StartRunInput {
  assistantKey: string;
  /** The user's request in natural language. */
  request: string;
  /** Live event sink for the dock (SSE). The audit record is `ai_run_steps`, not this. */
  onEvent?: (event: RunEvent) => void;
}

function lightweightPlan(assistant: AssistantDef, request: string): RunPlan {
  return {
    scope: request,
    tools: assistant.toolAllowlist,
    estimatedRecordsTouched: 0,
    steps: [
      { id: "s1", label: "Gather context", detail: "read neglected deals + timelines", status: "pending" },
      { id: "s2", label: "Draft follow-ups", detail: "tasks, next-action dates, email drafts", status: "pending" },
      { id: "s3", label: "Assemble change set", detail: "stage proposals for your approval", status: "pending" },
    ],
  };
}

async function emitRunEvent(type: string, runId: string, extra: Record<string, unknown> = {}): Promise<void> {
  await withTx((tx) => emit(tx, { type, subject: { type: "ai_run", id: runId }, payload: { runId, ...extra } }));
  await dispatchPending();
}

async function patchRun(id: string, fields: Partial<typeof aiRuns.$inferInsert>): Promise<void> {
  await withTx((tx) => tx.update(aiRuns).set({ ...fields, updatedAt: new Date() }).where(eq(aiRuns.id, id)));
}

/**
 * Launch an assistant run. Reads the tenant (org/workspace) + requesting principal
 * from the ambient context, then runs the whole loop under the assistant principal.
 * Resolves when the run reaches a terminal state (`preview_ready` / `done` / `failed`).
 */
export async function startRun(input: StartRunInput): Promise<RunModel> {
  const outer = requestContext.require();
  const assistant = getAssistant(input.assistantKey);
  const author = outer.principal;
  const orgId = outer.orgId;
  const workspaceId = outer.workspaceId;

  const assistantPrincipal: Principal = {
    kind: "assistant",
    id: assistant.principalId,
    orgId,
    workspaceId,
  };

  return requestContext.run({ principal: assistantPrincipal, orgId, workspaceId }, () =>
    runLoop(assistant, input, author),
  );
}

async function runLoop(
  assistant: AssistantDef,
  input: StartRunInput,
  author: Principal,
): Promise<RunModel> {
  const emitUi = input.onEvent ?? (() => {});
  const runId = newId();
  const model = modelForTier(assistant.modelTier);
  const ctx = requestContext.require();

  await withTx((tx) =>
    tx.insert(aiRuns).values({
      id: runId,
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId!,
      assistantKey: assistant.key,
      authorKind: author.kind,
      authorId: author.id,
      status: "executing",
      request: input.request,
      modelId: model,
      promptVersion: PROMPT_VERSION,
    }),
  );
  emitUi({ type: "run_started", runId });
  await appendStep(runId, "user_msg", { request: input.request });
  await emitRunEvent("ai.run_started", runId, { assistantKey: assistant.key });

  // Stage the change set up front (draft) so every proposal has a home. It is only
  // submitted for review when the model calls finalize_for_review.
  const changeSet = await createChangeSet({
    title: input.request.slice(0, 80),
    intent: input.request,
    origin: "ai_run",
  });
  await patchRun(runId, { changesetId: changeSet.id });

  const plan = lightweightPlan(assistant, input.request);
  await patchRun(runId, { plan });
  emitUi({ type: "plan_ready", plan });
  await emitRunEvent("ai.plan_ready", runId, { changesetId: changeSet.id });

  // The assistant is the actor (change-set author, record reads); the requesting user
  // is the capping owner for authorization (D-022). In the single-principal dogfood
  // these differ only in kind — a distinct personal-assistant owner uses the same path.
  const toolCtx: ToolContext = { runId, changesetId: changeSet.id, assistant, principal: ctx.principal, owner: author };
  const system = composeSystemPrompt(assistant);
  const tools = toAnthropicTools(assistant);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: input.request }];

  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const { message, usage } = await modelTurn({
        model,
        system,
        messages,
        tools,
        onTextDelta: (delta) => emitUi({ type: "message_delta", text: delta }),
      });
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      costUsd += usage.costUsd;
      await appendStep(runId, "model_turn", { content: message.content, stopReason: message.stop_reason }, usage);

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (text) emitUi({ type: "message", role: "assistant", text });

      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) break; // model is done

      messages.push({ role: "assistant", content: message.content as unknown as Anthropic.ContentBlockParam[] });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const outcome = await runTool(use.name, use.input, toolCtx);
        emitUi({ type: "tool_call", name: use.name, summary: outcome.ok ? "ok" : outcome.error });
        if (outcome.ok) {
          const draft = asEmailDraft(outcome.output);
          if (draft) emitUi({ type: "artifact", artifact: draft });
        }
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(outcome.ok ? outcome.output : { error: outcome.error }),
          is_error: !outcome.ok,
        });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    const message = isAppError(err) ? err.message : String(err);
    await patchRun(runId, {
      status: "failed",
      error: message,
      inputTokens,
      outputTokens,
      costUsd: String(costUsd),
    });
    emitUi({ type: "error", message });
    emitUi({ type: "status", status: "failed" });
    await emitRunEvent("ai.run_failed", runId, { error: message });
    return loadRun(runId);
  }

  const finalSet = await getChangeSet(changeSet.id);
  const changeCount = finalSet.changes.length;
  const status: RunStatus = "preview_ready";
  await patchRun(runId, { status, inputTokens, outputTokens, costUsd: String(costUsd) });
  for (const step of plan.steps) emitUi({ type: "plan_step", stepId: step.id, status: "done" });
  emitUi({ type: "preview_ready", changesetId: changeSet.id, changeCount });
  emitUi({ type: "status", status });
  await emitRunEvent("ai.preview_ready", runId, { changesetId: changeSet.id, status });
  return loadRun(runId);
}

/** Load a run as its public model. */
export async function loadRun(runId: string): Promise<RunModel> {
  const rows = await withTx((tx) => tx.select().from(aiRuns).where(eq(aiRuns.id, runId)).limit(1));
  const r = rows[0];
  if (!r) throw new Error(`run ${runId} not found`);
  return {
    id: r.id,
    assistantKey: r.assistantKey,
    status: r.status as RunStatus,
    request: r.request,
    plan: (r.plan as RunPlan | null) ?? null,
    changesetId: r.changesetId,
    modelId: r.modelId,
    promptVersion: r.promptVersion,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  };
}
