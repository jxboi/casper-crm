// casper-records — the record engine ("Objects"). Configurable record types with
// typed fields, one write path (can → validate → persist → event), the shared
// Filter AST, saved views, relations, and FTS. Domain-agnostic: product modules
// define their types as config.

import { registerMigrations } from "@casper/platform";
import { recordsMigrations } from "./migrations.js";
import { registerSystemTypes } from "./system-types.js";
import { registerActivityConsumer } from "./activity.js";

/**
 * Wire the module into the process: register migrations, the system record types,
 * and the `last_activity_at` event consumer. Call once at app/test bootstrap
 * (before `runMigrations`). Idempotent.
 */
export function registerRecordsModule(): void {
  registerMigrations(recordsMigrations);
  registerSystemTypes();
  registerActivityConsumer();
}

// Field registry / types
export type {
  FieldType,
  FieldDef,
  RecordTypeDef,
  RecordTypeName,
  SelectOption,
  RelationSpec,
} from "./field-types.js";
export {
  defineRecordType,
  getRecordType,
  tryGetRecordType,
  listRecordTypes,
  hasRecordType,
  resetRegistry,
} from "./registry.js";
export {
  SYSTEM_TYPES,
  taskType,
  noteType,
  attachmentType,
  registerSystemTypes,
} from "./system-types.js";

// Validation
export {
  validateRecordData,
  applyDefaults,
  resetValidatorCache,
  type ValidateOptions,
} from "./validation.js";

// Write path (the only mutators)
export {
  createRecord,
  updateRecord,
  archiveRecord,
  transitionOwner,
  bulkTransitionOwner,
  type RecordModel,
  type FieldDiff,
  type CreateRecordInput,
  type UpdateRecordInput,
  type ArchiveRecordInput,
  type TransitionOwnerInput,
} from "./write.js";

// Query engine
export {
  listRecords,
  getRecord,
  searchRecords,
  type ListRecordsInput,
  type ListRecordsResult,
  type Sort,
} from "./query.js";
export {
  compileFilter,
  type Filter,
  type LeafFilter,
  type FilterOp,
  type Duration,
  type DurationUnit,
} from "./filter.js";

// Relations
export { getRelated, getReferencing } from "./relations.js";

// Saved views
export {
  createSavedView,
  listSavedViews,
  renderView,
  type SavedViewModel,
  type CreateViewInput,
  type ViewLayout,
} from "./views.js";

export { recordsMigrations } from "./migrations.js";
export * as schema from "./schema.js";
