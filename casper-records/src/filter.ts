import { sql, type SQL } from "drizzle-orm";
import { AppError } from "@casper/platform";
import type { FieldType, RecordTypeDef } from "./field-types.js";
import { getFieldDef } from "./field-types.js";

/**
 * The shared Filter AST (master-plan §6) → parameterized SQL. This is the single
 * compilation path behind saved views, automation conditions, and assistant
 * queries — the success criterion is that it covers those needs with *no raw SQL
 * leaks*. Every value is bound as a parameter (never string-interpolated), and
 * unknown fields/operators raise `validation_failed` rather than reaching SQL.
 */
export type FilterOp =
  | "eq"
  | "neq"
  | "in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "is_empty"
  | "is_not_empty"
  | "within_last"
  | "older_than"
  | "no_activity_within";

export type DurationUnit = "minute" | "hour" | "day" | "week" | "month";
export interface Duration {
  amount: number;
  unit: DurationUnit;
}

export interface LeafFilter {
  field: string;
  op: FilterOp;
  value?: unknown;
}

export type Filter =
  | LeafFilter
  | { and: Filter[] }
  | { or: Filter[] }
  | { not: Filter };

const INTERVAL_UNIT: Record<DurationUnit, SQL> = {
  minute: sql.raw("interval '1 minute'"),
  hour: sql.raw("interval '1 hour'"),
  day: sql.raw("interval '1 day'"),
  week: sql.raw("interval '1 week'"),
  month: sql.raw("interval '1 month'"),
};

/** Columns promoted out of `data` — referenced directly, not via JSONB. */
const COLUMN_FIELDS: Record<string, { expr: SQL; kind: "text" | "uuid" | "timestamp" }> = {
  id: { expr: sql`id`, kind: "uuid" },
  owner: { expr: sql`owner_id`, kind: "uuid" },
  owner_id: { expr: sql`owner_id`, kind: "uuid" },
  created_at: { expr: sql`created_at`, kind: "timestamp" },
  updated_at: { expr: sql`updated_at`, kind: "timestamp" },
  archived_at: { expr: sql`archived_at`, kind: "timestamp" },
  last_activity_at: { expr: sql`last_activity_at`, kind: "timestamp" },
};

function intervalFor(value: unknown): SQL {
  const d = value as Duration | undefined;
  if (!d || typeof d.amount !== "number" || !(d.unit in INTERVAL_UNIT)) {
    throw AppError.validation("relative-date operator needs { amount, unit }");
  }
  return sql`(${d.amount} * ${INTERVAL_UNIT[d.unit]})`;
}

/** Typed SQL expression for a data field, cast per its field type. */
function dataExpr(key: string, fieldType: FieldType): SQL {
  switch (fieldType) {
    case "number":
      return sql`(data ->> ${key})::numeric`;
    case "money":
      return sql`((data -> ${key}) ->> 'amount')::numeric`;
    case "date":
    case "datetime":
      return sql`(data ->> ${key})::timestamptz`;
    case "checkbox":
      return sql`(data ->> ${key})::boolean`;
    default:
      return sql`(data ->> ${key})`;
  }
}

function compileLeaf(leaf: LeafFilter, type: RecordTypeDef): SQL {
  // Activity operator is always on the last_activity_at column.
  if (leaf.op === "no_activity_within") {
    return sql`(last_activity_at IS NULL OR last_activity_at < now() - ${intervalFor(leaf.value)})`;
  }

  const column = COLUMN_FIELDS[leaf.field];
  const fieldDef = column ? undefined : getFieldDef(type, leaf.field);
  if (!column && !fieldDef) {
    throw AppError.validation(`unknown field '${leaf.field}' on type '${type.key}'`);
  }
  const fieldType: FieldType = fieldDef?.type ?? "text";
  const isArrayField = fieldType === "multi_select" || fieldDef?.relation?.cardinality === "many";
  const expr = column ? column.expr : dataExpr(leaf.field, fieldType);

  switch (leaf.op) {
    case "eq":
      return sql`${expr} = ${leaf.value}`;
    case "neq":
      return sql`${expr} IS DISTINCT FROM ${leaf.value}`;
    case "gt":
      return sql`${expr} > ${leaf.value}`;
    case "gte":
      return sql`${expr} >= ${leaf.value}`;
    case "lt":
      return sql`${expr} < ${leaf.value}`;
    case "lte":
      return sql`${expr} <= ${leaf.value}`;
    case "in": {
      const arr = Array.isArray(leaf.value) ? leaf.value : [];
      if (arr.length === 0) return sql`false`;
      return sql`${expr} IN (${sql.join(arr.map((v) => sql`${v}`), sql`, `)})`;
    }
    case "contains":
      if (isArrayField) {
        // membership in a JSONB array of strings
        return sql`(data -> ${leaf.field}) ? ${String(leaf.value)}`;
      }
      return sql`${expr} ILIKE ${"%" + String(leaf.value) + "%"}`;
    case "is_empty":
      if (column) return sql`${expr} IS NULL`;
      return sql`((data ->> ${leaf.field}) IS NULL OR (data ->> ${leaf.field}) = '')`;
    case "is_not_empty":
      if (column) return sql`${expr} IS NOT NULL`;
      return sql`((data ->> ${leaf.field}) IS NOT NULL AND (data ->> ${leaf.field}) <> '')`;
    case "within_last":
      return sql`${expr} >= now() - ${intervalFor(leaf.value)}`;
    case "older_than":
      return sql`${expr} < now() - ${intervalFor(leaf.value)}`;
    default:
      throw AppError.validation(`unsupported operator '${leaf.op as string}'`);
  }
}

export function compileFilter(filter: Filter, type: RecordTypeDef): SQL {
  if ("and" in filter) {
    if (filter.and.length === 0) return sql`true`;
    return sql`(${sql.join(
      filter.and.map((f) => compileFilter(f, type)),
      sql` AND `,
    )})`;
  }
  if ("or" in filter) {
    if (filter.or.length === 0) return sql`false`;
    return sql`(${sql.join(
      filter.or.map((f) => compileFilter(f, type)),
      sql` OR `,
    )})`;
  }
  if ("not" in filter) {
    return sql`NOT (${compileFilter(filter.not, type)})`;
  }
  return compileLeaf(filter, type);
}
