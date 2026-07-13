import { AppError } from "@casper/platform";
import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from "./definition.js";
import { registerStageChangedType } from "./events.js";

/**
 * In-memory workflow registry — the same pattern as the records type registry
 * (`defineRecordType`). Product modules register their versioned workflow config
 * as data; the engine reads it from here (never from I/O), keeping `evaluate` pure.
 * The `workflow_definitions` table is a persisted snapshot for introspection, not
 * the hot-path source of truth (P1a).
 *
 * One active definition per record type in P1a; multi-version rollout is P1b/P3.
 */
const workflows = new Map<string, WorkflowDefinition>();

export function defineWorkflow(raw: WorkflowDefinition | unknown): WorkflowDefinition {
  const def = parseWorkflowDefinition(raw);
  setActiveDefinition(def);
  return def;
}

/**
 * Point the in-memory hot path at an (already-validated) definition — used by
 * `defineWorkflow` (code-seeded/test) and by publishing (`applyConfigPublish`) when
 * a new version becomes active. `evaluate`/`transition` read this active pointer.
 */
export function setActiveDefinition(def: WorkflowDefinition): void {
  workflows.set(def.recordType, def);
  // Registering the per-type semantic event keeps the stream well-typed.
  registerStageChangedType(def.recordType);
}

/** The active version currently in effect for a record type, if any. */
export function getActiveVersion(recordType: string): number | undefined {
  return workflows.get(recordType)?.version;
}

export function getWorkflow(recordType: string): WorkflowDefinition {
  const def = workflows.get(recordType);
  if (!def) throw AppError.notFound(`no workflow defined for record type '${recordType}'`);
  return def;
}

export function tryGetWorkflow(recordType: string): WorkflowDefinition | undefined {
  return workflows.get(recordType);
}

export function hasWorkflow(recordType: string): boolean {
  return workflows.has(recordType);
}

export function listWorkflows(): WorkflowDefinition[] {
  return [...workflows.values()];
}

/** Test hook. */
export function resetWorkflowRegistry(): void {
  workflows.clear();
}
