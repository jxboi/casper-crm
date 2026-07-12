/**
 * Field registry types (records plan "Field registry"; D-012, D-013). Product
 * modules describe their record types purely as this config — the engine stays
 * domain-agnostic. Money is minor units + ISO currency (D-012).
 */
export type FieldType =
  | "text"
  | "long_text"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "select"
  | "multi_select"
  | "checkbox"
  | "user"
  | "relation"
  | "email"
  | "phone"
  | "url"
  | "json";

export interface SelectOption {
  value: string;
  label: string;
}

export interface RelationSpec {
  /** Target record type key. */
  targetType: string;
  cardinality: "one" | "many";
  /** Semantic label, e.g. "primary contact". */
  label?: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Uniqueness constraint enforcement is P2; the flag is stored now. */
  unique?: boolean;
  default?: unknown;
  options?: SelectOption[];
  relation?: RelationSpec;
  /** D-020: raises edit risk and caps assistants; does not hide from reads in P0. */
  sensitivity?: boolean;
  archived?: boolean;
  // Validation rules.
  min?: number;
  max?: number;
  /** Default currency for money fields. */
  currency?: string;
}

export interface RecordTypeName {
  singular: string;
  plural: string;
}

export interface RecordTypeDef {
  key: string;
  name: RecordTypeName;
  icon?: string;
  color?: string;
  /** `system` = defined in code; `product` = seeded versioned config. */
  origin: "system" | "product";
  /** Field key used as the record's display label. */
  primaryField: string;
  /** Config version (D-013) — snapshots are versioned; edits bump it. */
  version: number;
  fields: FieldDef[];
}

/** Fields promoted to real columns rather than living in `data` JSONB. */
export const RESERVED_FIELDS = new Set([
  "id",
  "owner",
  "owner_id",
  "version",
  "created_at",
  "updated_at",
  "archived_at",
  "last_activity_at",
]);

export function getFieldDef(type: RecordTypeDef, key: string): FieldDef | undefined {
  return type.fields.find((f) => f.key === key);
}
