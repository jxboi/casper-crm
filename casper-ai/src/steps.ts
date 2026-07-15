import { count, eq } from "drizzle-orm";
import { newId, requestContext, withTx, type Tx } from "@casper/platform";
import { aiRunSteps } from "./schema.js";
import type { RunStepType } from "./types.js";

/**
 * Append a run step — the audit trail (D-016). Every model turn and tool call is a
 * row here, independent of the UI stream, so "what did the assistant do and why" is
 * answerable from storage alone. Position is the current step count for the run.
 */
export async function appendStep(
  runId: string,
  type: RunStepType,
  payload: unknown,
  usage?: { inputTokens?: number; outputTokens?: number },
): Promise<void> {
  const ctx = requestContext.require();
  await withTx(async (tx: Tx) => {
    const rows = await tx
      .select({ n: count() })
      .from(aiRunSteps)
      .where(eq(aiRunSteps.runId, runId));
    await tx.insert(aiRunSteps).values({
      id: newId(),
      runId,
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId!,
      position: Number(rows[0]?.n ?? 0),
      type,
      payload,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
  });
}
