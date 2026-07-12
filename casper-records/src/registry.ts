import { AppError } from "@casper/platform";
import type { RecordTypeDef } from "./field-types.js";

/**
 * In-memory record-type registry. System types are registered in code at boot;
 * product modules (casper-sales) register their versioned config the same way —
 * proving the success criterion that a new type is definable purely as config,
 * with no engine change. The registry is the source of truth for validation and
 * query compilation; `record_types`/`field_defs` rows are a persisted snapshot
 * for introspection (the playground registry browser, config versioning).
 */
const types = new Map<string, RecordTypeDef>();

export function defineRecordType(def: RecordTypeDef): void {
  const existing = types.get(def.key);
  if (existing && existing.version !== def.version) {
    // Re-registering with a new version is how config evolves (D-013).
    types.set(def.key, def);
    return;
  }
  types.set(def.key, def);
}

export function getRecordType(key: string): RecordTypeDef {
  const def = types.get(key);
  if (!def) throw AppError.notFound(`unknown record type '${key}'`);
  return def;
}

export function tryGetRecordType(key: string): RecordTypeDef | undefined {
  return types.get(key);
}

export function listRecordTypes(): RecordTypeDef[] {
  return [...types.values()];
}

export function hasRecordType(key: string): boolean {
  return types.has(key);
}

/** Test hook. */
export function resetRegistry(): void {
  types.clear();
}
