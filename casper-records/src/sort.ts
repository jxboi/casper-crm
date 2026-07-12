import { sql, type SQL } from "drizzle-orm";
import { AppError } from "@casper/platform";
import { getFieldDef, type RecordTypeDef } from "./field-types.js";

/**
 * Sort expressions. Each carries its Postgres type so cursor (keyset) pagination
 * can cast the cursor value to match the ORDER BY expression — otherwise a numeric
 * sort compared against a text cursor param would error or mis-order.
 */
export type PgType = "numeric" | "timestamptz" | "uuid" | "text";

export interface SortSpec {
  expr: SQL;
  pgType: PgType;
}

export const COLUMN_SORTS: Record<string, SortSpec> = {
  id: { expr: sql`id`, pgType: "uuid" },
  owner: { expr: sql`owner_id`, pgType: "uuid" },
  owner_id: { expr: sql`owner_id`, pgType: "uuid" },
  created_at: { expr: sql`created_at`, pgType: "timestamptz" },
  updated_at: { expr: sql`updated_at`, pgType: "timestamptz" },
  last_activity_at: { expr: sql`last_activity_at`, pgType: "timestamptz" },
};

export function dataSortExpr(type: RecordTypeDef, field: string): SortSpec {
  const def = getFieldDef(type, field);
  if (!def) throw AppError.validation(`unknown sort field '${field}' on type '${type.key}'`);
  switch (def.type) {
    case "number":
      return { expr: sql`(data ->> ${field})::numeric`, pgType: "numeric" };
    case "money":
      return { expr: sql`((data -> ${field}) ->> 'amount')::numeric`, pgType: "numeric" };
    case "date":
    case "datetime":
      return { expr: sql`(data ->> ${field})::timestamptz`, pgType: "timestamptz" };
    default:
      return { expr: sql`(data ->> ${field})`, pgType: "text" };
  }
}
