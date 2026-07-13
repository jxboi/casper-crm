import type { AutomationDefinition } from "@casper/workflow";

/**
 * Default sales automations (casper-sales plan §Scope), as trigger–condition–action
 * config over the workflow automation engine. They execute through the module write
 * paths under the system principal (the change-set/approval gate is the authorization),
 * and their effect events are stamped `source: "automation"`.
 */

/**
 * Deal → Won ⇒ create the onboarding kickoff task. This is the reference doc's
 * canonical example. Conditions are evaluated at enqueue against the stage_changed
 * event, so only the →Won transition fires it (not intermediate stage changes).
 */
export const onboardingOnWon: AutomationDefinition = {
  id: "sales.onboarding-on-won",
  version: 1,
  recordType: "deal",
  trigger: "deal.stage_changed",
  condition: { field: "stage", op: "eq", value: "won" },
  actions: [
    {
      kind: "create_task",
      title: "Kick off customer onboarding",
      priority: "high",
      relateToTrigger: true,
    },
  ],
  enabled: true,
};

/**
 * Deal → Lost ⇒ notify the owner's manager (plan: optional, org-toggled). In P1a the
 * `notify` action emits `notification.requested`; resolving "owner's manager" per the
 * org's `managerModel` (D-021) is the notification consumer's job and is deferred —
 * so no static `to` is set here. Left `enabled` for the dogfood default; an org toggle
 * to disable it is admin config (P1c).
 */
export const notifyManagerOnLost: AutomationDefinition = {
  id: "sales.notify-manager-on-lost",
  version: 1,
  recordType: "deal",
  trigger: "deal.stage_changed",
  condition: { field: "stage", op: "eq", value: "lost" },
  actions: [
    {
      kind: "notify",
      channel: "inapp",
      message: "A deal was marked Lost — review the lost reason.",
    },
  ],
  enabled: true,
};

export const SALES_AUTOMATIONS: AutomationDefinition[] = [
  onboardingOnWon,
  notifyManagerOnLost,
];
