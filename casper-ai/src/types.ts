import type { z } from "zod";
import type { Principal } from "@casper/platform";

/**
 * casper-ai contracts. The run engine (run.ts), tool framework (tools/), and
 * model gateway (gateway.ts) all speak these shapes. Kept deliberately small for
 * the P1b slice — the clarifying/awaiting-approval states, richer policy caps, and
 * WDK durability metadata land as the loop grows (see plan.md phasing).
 */

/**
 * Run lifecycle. The P1b subset runs straight through to `preview_ready` (a staged
 * draft change set) and stops — approval + commit are a separate human action in
 * casper-changesets. `clarifying` / `awaiting_plan_approval` / `awaiting_approval`
 * arrive with P1c + WDK `createHook` suspensions.
 */
export type RunStatus =
  | "intake"
  | "planning"
  | "executing"
  | "preview_ready"
  | "done"
  | "failed"
  | "cancelled";

/** Persisted step kinds — the audit trail (D-016). */
export type RunStepType = "model_turn" | "tool_call" | "user_msg" | "system";

/**
 * Approval policy per action class (D-007). Policies narrow platform permissions;
 * they can never widen them. Enforcement of anything beyond `never` is P2 — for the
 * P1b slice the whole run lands as a reviewable change set regardless, so `never`
 * (permission-changing actions) is the only class that must be honoured at author
 * time, and casper-changesets/casper-auth already gate that.
 */
export type Policy = "always_allow" | "allow_within_limits" | "batch_review" | "require_every_time" | "never";

/** Coarse action classes the policy matrix keys on. */
export type ActionClass = "read" | "propose_task" | "propose_field" | "propose_transition" | "artifact" | "config_publish";

/** Per-org / per-run budget ceilings. Recorded from the first run; hard-stop enforcement is P2. */
export interface AssistantBudgets {
  perRunTokenCap: number;
  maxRecordsPerRun: number;
  dailyTokenCap?: number;
}

/**
 * An assistant definition — data, not code (D-004), seeded from product modules
 * (casper-sales defines the Sales Follow-up Assistant). Effective permissions are
 * the registry scope ∩ the owner's permissions, computed by `can()` at tool time.
 */
export interface AssistantDef {
  key: string;
  name: string;
  purpose: string;
  /** The linked assistant principal (a real auth principal, provisioned at seed time). */
  principalId: string;
  /** Optional human owner — effective permissions are capped by theirs (D-022). */
  ownerUserId?: string;
  /** Which tools this assistant may call, by name (see tools/). */
  toolAllowlist: string[];
  modelTier: "opus" | "sonnet" | "haiku";
  promptVersion: string;
  policyMatrix: Partial<Record<ActionClass, Policy>>;
  budgets: AssistantBudgets;
}

/** What every tool receives: the run it belongs to and the acting assistant principal. */
export interface ToolContext {
  runId: string;
  changesetId: string;
  assistant: AssistantDef;
  /** The acting assistant principal — author of the change set, subject of record reads. */
  principal: Principal;
  /**
   * The capping identity for authorization (D-022): effective permissions are the
   * registry scope ∩ the owner's permissions. Proposals are `can()`-checked against
   * this principal, not the assistant — an assistant can never propose what its owner
   * could not do.
   */
  owner: Principal;
}

/**
 * A controlled tool (master-plan §6). `run` is invoked only after the framework has
 * asserted tenant scope, `can()` for the assistant principal, and risk/budget — see
 * tools/runTool. Read tools respect field masks; propose tools write only into the
 * run's change set. `actionClass` selects the policy-matrix row.
 */
export interface ToolDef<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  actionClass: ActionClass;
  run(input: I, ctx: ToolContext): Promise<O>;
}

export interface RunModel {
  id: string;
  assistantKey: string;
  status: RunStatus;
  request: string;
  plan: RunPlan | null;
  changesetId: string | null;
  modelId: string | null;
  promptVersion: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  error: string | null;
  createdAt: string;
}

export interface RunPlanStep {
  id: string;
  label: string;
  detail: string;
  status: "pending" | "active" | "done";
}

export interface RunPlan {
  scope: string;
  steps: RunPlanStep[];
  tools: string[];
  estimatedRecordsTouched: number;
}

/**
 * Events streamed to the dock over SSE. The persisted `ai_run_steps` are the audit
 * record; these are the live projection the four AI surfaces render. Keep in sync
 * with casper-web's dock consumer.
 */
export type RunEvent =
  | { type: "run_started"; runId: string }
  | { type: "message"; role: "assistant"; text: string }
  | { type: "message_delta"; text: string }
  | { type: "plan_ready"; plan: RunPlan }
  | { type: "plan_step"; stepId: string; status: RunPlanStep["status"] }
  | { type: "tool_call"; name: string; summary: string }
  | { type: "preview_ready"; changesetId: string; changeCount: number }
  | { type: "artifact"; artifact: EmailDraftArtifact }
  | { type: "status"; status: RunStatus }
  | { type: "error"; message: string };

/** A draft email produced by the run — a deliverable, not a record change or a sent message. */
export interface EmailDraftArtifact {
  kind: "email_draft";
  dealId: string;
  to?: string;
  subject: string;
  body: string;
}
