// casper-workflow — the workflow engine (D-014). Versioned, immutable workflow
// definitions (stages, guarded transitions, assignment, SLA rules) evaluated by a
// PURE function `evaluate(definition, record, intent, now) → Effect[]`. That purity
// is the module's architectural core: it makes P3 simulation, shadow mode, and
// gradual rollout cheap instead of a rewrite. Domain-agnostic — product modules
// (casper-sales) express their pipeline entirely as config.

import { registerMigrations } from "@casper/platform";
import { workflowMigrations } from "./migrations.js";
import { registerWorkflowEventTypes } from "./events.js";
import { registerAutomationConsumer } from "./automation-runtime.js";

/**
 * Wire the module into the process: register migrations, the workflow event-type
 * schemas, and the automation consumer (P1b). Call once at app/test bootstrap
 * (before `runMigrations`). Idempotent.
 */
export function registerWorkflowModule(): void {
  registerMigrations(workflowMigrations);
  registerWorkflowEventTypes();
  registerAutomationConsumer();
}

// Definitions (config-as-data)
export {
  parseWorkflowDefinition,
  findTransition,
  workflowDefinitionSchema,
  stageSchema,
  transitionSchema,
  guardSchema,
  assignRuleSchema,
  slaRuleSchema,
  durationSchema,
  filterSchema,
  type WorkflowDefinition,
  type Stage,
  type TransitionDef,
  type Guard,
  type AssignRule,
  type SlaRule,
} from "./definition.js";

// Registry
export {
  defineWorkflow,
  setActiveDefinition,
  getActiveVersion,
  getWorkflow,
  tryGetWorkflow,
  hasWorkflow,
  listWorkflows,
  resetWorkflowRegistry,
} from "./registry.js";

// Publishing (immutable config versions — executor primitives for casper-changesets)
export {
  applyConfigPublish,
  diffWorkflow,
  listVersions,
  loadActiveWorkflows,
  type WorkflowDiff,
} from "./publish.js";

// Pure core
export {
  evaluate,
  type Effect,
  type EvaluateResult,
  type GuardViolation,
  type RecordSnapshot,
  type TransitionIntent,
} from "./evaluate.js";
export { evaluateFilter, type FilterRecord } from "./filter-eval.js";

// Transition API (the only way stage changes)
export { transition, type TransitionInput } from "./transition.js";

// Assignment
export {
  resolveAssignment,
  runAssignment,
  onRecordCreated,
  type AssignTarget,
} from "./assignment.js";

// SLA / staleness scan
export { scanSla, slaRuleToFilter, type SlaBreach } from "./sla.js";

// Automation engine (trigger–condition–action)
export {
  actionSchema,
  automationDefinitionSchema,
  parseAutomationDefinition,
  type Action,
  type AutomationDefinition,
} from "./automation-definition.js";
export {
  defineAutomation,
  getAutomation,
  listAutomationsForEvent,
  listAutomations,
  resetAutomationRegistry,
} from "./automation-registry.js";
export { evaluateAutomation, type AutomationEvalResult } from "./evaluate-automation.js";
export {
  runPendingAutomations,
  registerAutomationConsumer,
  getAutomationRuns,
} from "./automation-runtime.js";

// Events + migrations
export {
  registerWorkflowEventTypes,
  registerStageChangedType,
  stageChangedSchema,
  slaBreachSchema,
} from "./events.js";
export { workflowMigrations } from "./migrations.js";
export * as schema from "./schema.js";
