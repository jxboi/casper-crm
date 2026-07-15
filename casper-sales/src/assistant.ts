import type { AssistantDef } from "@casper/ai";

/**
 * The Sales Follow-up Assistant — the product's first governed digital worker,
 * expressed as data (D-004), like the pipeline and automations. casper-ai makes it
 * safe and possible; this module supplies its identity, scope, and prompt-pack
 * version. It reads neglected deals and stages follow-up tasks + next-action dates
 * (and optional email drafts) as a change set for the user to approve — it never
 * writes a record directly.
 *
 * The linked assistant principal is a stable synthetic id used only for attribution
 * (change-set author, run context); authorization is capped by the requesting user
 * (D-022), so no separate grants are provisioned for it in the M1 slice.
 */
export const SALES_FOLLOWUP_ASSISTANT_PRINCIPAL_ID = "a5515747-0000-4000-8000-000000000001";

export const salesFollowupAssistant: AssistantDef = {
  key: "sales-followup",
  name: "Sales Follow-up Assistant",
  purpose:
    "You help a salesperson stay on top of neglected deals. For each deal that has gone quiet, " +
    "review its timeline, then stage a concrete next step: a follow-up task with a due date, an " +
    "updated next-action date on the deal, and optionally a draft follow-up email. Keep proposals " +
    "specific and grounded in the deal's actual history.",
  principalId: SALES_FOLLOWUP_ASSISTANT_PRINCIPAL_ID,
  toolAllowlist: [
    "search_records",
    "read_record",
    "read_timeline",
    "propose_create_task",
    "propose_update_field",
    "draft_email",
    "finalize_for_review",
  ],
  modelTier: "opus",
  promptVersion: "sales-followup@0.1.0",
  // Proposals ride the default (always_allow → still land as a reviewable change set);
  // config publishing is never available to this assistant.
  policyMatrix: { config_publish: "never" },
  budgets: { perRunTokenCap: 200_000, maxRecordsPerRun: 25 },
};
