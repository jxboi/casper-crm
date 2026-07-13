import type { WorkflowDefinition } from "@casper/workflow";

/**
 * The sales pipeline as workflow config (casper-sales plan §Scope) over the pure
 * workflow engine. Stages, guarded transitions, and SLA rules are plain data — the
 * engine's `evaluate()` is pure over this, so P3 simulation/shadow mode stays cheap.
 *
 * Pipeline: New → Qualified → Proposal → Negotiation → Won | Lost.
 * Guards:
 *  - amount + expected close required to enter Proposal;
 *  - lost reason required to enter Lost (allowed from any open stage).
 *
 * Re-opening a closed deal (Won/Lost → Qualified) is exposed as a transition. The
 * plan asks for "only Manager+ may re-open"; the guard model's `permission` is a
 * single action checked against the record, and the built-in grants distinguish
 * manager from member by *scope* (own vs team), not by a distinct re-open action —
 * so manager-only re-open cannot be expressed here without an engine capability (a
 * dedicated `record.reopen` action + grant). Per the plan's own rule ("if it needs
 * an engine change, that's a signal the engine needs a capability"), the transition
 * ships now with the default `record.transition` permission and the manager-only
 * refinement is flagged for the engine, not hacked into product config.
 */
export const dealPipeline: WorkflowDefinition = {
  recordType: "deal",
  version: 1,
  status: "active",
  initialStage: "new",
  stageField: "stage",
  stageEnteredAtField: "stageEnteredAt",
  stages: [
    { key: "new", name: "New", category: "open", order: 0 },
    { key: "qualified", name: "Qualified", category: "open", order: 1 },
    { key: "proposal", name: "Proposal", category: "open", order: 2 },
    { key: "negotiation", name: "Negotiation", category: "open", order: 3 },
    { key: "won", name: "Won", category: "won", order: 4 },
    { key: "lost", name: "Lost", category: "lost", order: 5 },
  ],
  transitions: [
    { from: "new", to: "qualified", guard: { requiredFields: [], permission: "record.transition" } },
    {
      from: "qualified",
      to: "proposal",
      guard: {
        requiredFields: ["amount", "expectedCloseDate"],
        permission: "record.transition",
      },
    },
    { from: "proposal", to: "negotiation", guard: { requiredFields: [], permission: "record.transition" } },
    { from: "negotiation", to: "won", guard: { requiredFields: [], permission: "record.transition" } },
    // Lost is reachable from any open stage; a lost reason is mandatory.
    {
      from: "*",
      to: "lost",
      guard: { requiredFields: ["lostReason"], permission: "record.transition" },
    },
    // Re-open (see the module note above re: manager-only enforcement).
    { from: "won", to: "qualified", guard: { requiredFields: [], permission: "record.transition" } },
    { from: "lost", to: "qualified", guard: { requiredFields: [], permission: "record.transition" } },
  ],
  /**
   * Neglect rules — the assistant's trigger, defined as config (plan §Scope). Both
   * emit `record.neglected`, consumed by the assistant digest, the Neglected-deals
   * view, and notifications. "Next action date overdue" is the third neglect signal
   * from the plan; it is not an SLA *kind* (SLA kinds are inactivity / stage_age), so
   * it lives in the Neglected-deals view filter instead (see views.ts) — both read
   * the same records via the Filter AST.
   */
  sla: [
    {
      key: "deal_inactive_14d",
      kind: "inactivity",
      threshold: { amount: 14, unit: "day" },
      event: "record.neglected",
    },
    {
      key: "deal_stuck_in_stage_30d",
      kind: "stage_age",
      threshold: { amount: 30, unit: "day" },
      event: "record.neglected",
    },
  ],
};
