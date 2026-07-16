import { z } from "zod";
import { addChange, submitForReview } from "@casper/changesets";
import { getTimeline } from "@casper/events";
import { getRecord, searchRecords } from "@casper/records";
import type { ToolDef } from "./types.js";

/**
 * The M1 toolset (Phase 1b — 7 tools). Read tools return structured JSON (never
 * prose) so a record body can carry no instruction channel (D-016); propose tools
 * write only into the run's draft change set via casper-changesets — they have no
 * path to a live record. `propose_transition`, `get_workflow_definition`, and
 * `ask_user` land in P1c.
 *
 * Every tool here is invoked only through `runTool` (run-tool.ts), which asserts the
 * allowlist, tenant scope, `can()` for the assistant principal, and policy/risk
 * before `run` executes and logs the call as a step.
 */

// ---- read tools -------------------------------------------------------------

const searchRecordsTool: ToolDef<{ query: string; type?: string; limit?: number }> = {
  name: "search_records",
  description:
    "Full-text search records in the workspace. Optionally narrow by record type " +
    "(e.g. 'deal', 'company', 'contact'). Returns up to `limit` lean record summaries.",
  actionClass: "read",
  inputSchema: z.object({
    query: z.string().min(1),
    type: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async run(input) {
    const rows = await searchRecords(input);
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      data: r.data,
      ownerId: r.ownerId,
      lastActivityAt: r.lastActivityAt,
    }));
  },
};

const readRecordTool: ToolDef<{ type: string; id: string }> = {
  name: "read_record",
  description: "Read one record by type and id. Returns null if it does not exist or is not visible.",
  actionClass: "read",
  inputSchema: z.object({ type: z.string(), id: z.string() }),
  async run(input) {
    const r = await getRecord(input.type, input.id);
    if (!r) return null;
    return { id: r.id, type: r.type, data: r.data, ownerId: r.ownerId, version: r.version, lastActivityAt: r.lastActivityAt };
  },
};

const readTimelineTool: ToolDef<{ type: string; id: string; limit?: number }> = {
  name: "read_timeline",
  description: "Read a record's activity timeline (events projected from the audit log), newest first.",
  actionClass: "read",
  inputSchema: z.object({ type: z.string(), id: z.string(), limit: z.number().int().min(1).max(100).optional() }),
  async run(input) {
    const entries = await getTimeline({ type: input.type, id: input.id }, { limit: input.limit ?? 50 });
    return entries.map((e) => ({ kind: e.kind, summary: e.summary, actorKind: e.actorKind, occurredAt: e.occurredAt }));
  },
};

// ---- propose tools (write only into the run's change set) --------------------

const proposeCreateTaskTool: ToolDef<{ dealId: string; title: string; dueDate: string }> = {
  name: "propose_create_task",
  description:
    "Propose a follow-up task on a deal. Stages a task-create in the run's change set — " +
    "nothing is created until a human approves and commits. `dueDate` is ISO (YYYY-MM-DD).",
  actionClass: "propose_task",
  inputSchema: z.object({ dealId: z.string(), title: z.string().min(1), dueDate: z.string() }),
  async run(input, ctx) {
    const change = await addChange(ctx.changesetId, {
      op: "create",
      target: { kind: "record", type: "task" },
      payload: {
        title: input.title,
        due: input.dueDate,
        status: "open",
        source: "ai",
        relatedTo: { type: "deal", id: input.dealId },
      },
    });
    return { ok: true as const, changeId: change.id };
  },
};

const proposeUpdateFieldTool: ToolDef<{ type: string; id: string; field: string; value?: unknown }> = {
  name: "propose_update_field",
  description:
    "Propose a single field edit on a record (e.g. set a deal's nextActionDate). Stages an " +
    "update in the run's change set — nothing changes until a human approves and commits.",
  actionClass: "propose_field",
  inputSchema: z.object({ type: z.string(), id: z.string(), field: z.string(), value: z.unknown() }),
  async run(input, ctx) {
    const change = await addChange(ctx.changesetId, {
      op: "update",
      target: { kind: "record", type: input.type, id: input.id },
      payload: { [input.field]: input.value },
    });
    return { ok: true as const, changeId: change.id };
  },
};

// ---- artifact / control tools ----------------------------------------------

const draftEmailTool: ToolDef<{ dealId: string; to?: string; subject: string; body: string }> = {
  name: "draft_email",
  description:
    "Draft a follow-up email for a deal. This is a workspace artifact (a deliverable), " +
    "not a record change and not a sent message — it is surfaced for the user to review and send. " +
    "Include the recipient (`to`) when you know the contact's email.",
  actionClass: "artifact",
  inputSchema: z.object({ dealId: z.string(), to: z.string().optional(), subject: z.string(), body: z.string() }),
  async run(input) {
    return { kind: "email_draft" as const, dealId: input.dealId, to: input.to, subject: input.subject, body: input.body };
  },
};

const finalizeForReviewTool: ToolDef<{ summary: string }> = {
  name: "finalize_for_review",
  description:
    "Call once when the change set is complete. Submits it for review (draft → in_review) and " +
    "records your one-line summary of what you staged. After this the run is done.",
  actionClass: "artifact",
  inputSchema: z.object({ summary: z.string().min(1) }),
  async run(input, ctx) {
    await submitForReview(ctx.changesetId);
    return { ok: true as const, summary: input.summary };
  },
};

/** The M1 registry, keyed by tool name. `run-tool.ts` resolves against this. */
export const M1_TOOLS: Record<string, ToolDef<any, any>> = {
  search_records: searchRecordsTool,
  read_record: readRecordTool,
  read_timeline: readTimelineTool,
  propose_create_task: proposeCreateTaskTool,
  propose_update_field: proposeUpdateFieldTool,
  draft_email: draftEmailTool,
  finalize_for_review: finalizeForReviewTool,
};
