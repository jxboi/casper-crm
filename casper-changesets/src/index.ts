// casper-changesets — the transactional workspace / change-set model (architectural
// bet #1; D-006/D-007). Risky mutations from any origin (AI runs, workflow publishes,
// bulk edits) become structured, previewable, individually-approvable,
// atomically-committable change sets — live data untouched until approval. Commit
// applies **through module write APIs** (records/workflow), never direct table writes.

import { registerMigrations } from "@casper/platform";
import { changesetsMigrations } from "./migrations.js";
import { registerChangesetEventTypes } from "./events.js";

/**
 * Wire the module into the process: register migrations + the change-set event
 * schemas. Call once at app/test bootstrap (before `runMigrations`). Idempotent.
 */
export function registerChangesetsModule(): void {
  registerMigrations(changesetsMigrations);
  registerChangesetEventTypes();
}

// Lifecycle
export {
  createChangeSet,
  addChange,
  submitForReview,
  approveChange,
  rejectChange,
  approveAll,
  getChangeSet,
  listChangeSets,
} from "./changeset.js";
export { commitChangeSet } from "./commit.js";

// Overlay / diff
export { readThroughChangeset, type OverlayResult } from "./overlay.js";
export { previewChangeSet, type ChangeSetPreview, type ChangePreview } from "./diff.js";

// Risk + contracts
export { computeRisk } from "./risk.js";
export {
  recordRefSchema,
  configRefSchema,
  targetSchema,
  type ChangeTarget,
  type Risk,
  type ChangeOp,
  type Origin,
  type ChangeSetStatus,
  type Approval,
  type ValidationResult,
  type ValidationIssue,
  type ChangeModel,
  type ChangeSetModel,
  type AddChangeInput,
} from "./types.js";

export { changesetsMigrations } from "./migrations.js";
export * as schema from "./schema.js";
