// casper-ai — the AI orchestration layer (governed digital workers; D-004/D-007/D-009).
// Provides the assistant registry, the run engine (request → plan → execute →
// preview → hand off for approval), the controlled tool framework, and the model
// gateway. Safety is structural: mutation tools write only into a change set and
// commit is a human action in casper-changesets — there is no path from model
// output to a committed write inside this module.

import { registerMigrations } from "@casper/platform";
import { aiMigrations } from "./migrations.js";
import { registerAiEventTypes } from "./events.js";

/**
 * Wire the module into the process: register migrations + the ai.* event schemas.
 * Call once at app/test bootstrap (before `runMigrations`). Idempotent. Assistant
 * definitions are registered separately by product modules (see registerAssistant).
 */
export function registerAiModule(): void {
  registerMigrations(aiMigrations);
  registerAiEventTypes();
}

// Registry (assistant definitions — data, seeded by product modules)
export {
  registerAssistant,
  getAssistant,
  tryGetAssistant,
  listAssistants,
  resetAssistantRegistry,
} from "./registry.js";

// Gateway
export {
  PROMPT_VERSION,
  modelForTier,
  composeSystemPrompt,
  dataBlock,
  modelTurn,
  type ModelTurnInput,
  type ModelTurnResult,
  type ModelUsage,
} from "./gateway.js";

// Run engine
export { startRun, loadRun, type StartRunInput } from "./run.js";

// Tool framework
export { M1_TOOLS } from "./tools.js";
export { runTool, toAnthropicTools, type ToolOutcome } from "./run-tool.js";
export { appendStep } from "./steps.js";

// Contracts
export type {
  RunStatus,
  RunStepType,
  Policy,
  ActionClass,
  AssistantBudgets,
  AssistantDef,
  ToolContext,
  ToolDef,
  RunModel,
  RunPlan,
  RunPlanStep,
  RunEvent,
  EmailDraftArtifact,
} from "./types.js";

export { aiMigrations } from "./migrations.js";
export * as schema from "./schema.js";
