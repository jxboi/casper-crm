import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { AppError, requestContext, withTx } from "@casper/platform";
import { records } from "./schema.js";
import { getRecordType } from "./registry.js";
import { compileFilter, type Filter } from "./filter.js";
import { COLUMN_SORTS, dataSortExpr, type SortSpec } from "./sort.js";
import type { RecordModel } from "./write.js";

/**
 * Read side. Queries are workspace-scoped only (D-020 open read — no per-row
 * visibility filtering); RLS + the workspace predicate handle tenant scoping.
 * The Filter AST compiles to parameterized SQL (filter.ts). Cursor pagination is
 * keyset on (sortExpr, id) so pages are stable under concurrent inserts.
 */
export interface Sort {
  field: string;
  direction: "asc" | "desc";
}

export interface ListRecordsInput {
  type: string;
  filter?: Filter;
  sort?: Sort;
  limit?: number;
  cursor?: string;
  /** Include archived records (default false). */
  includeArchived?: boolean;
}

export interface ListRecordsResult {
  records: RecordModel[];
  nextCursor: string | null;
}

const SELECT = {
  id: records.id,
  type: records.type,
  data: records.data,
  ownerId: records.ownerId,
  version: records.version,
  lastActivityAt: records.lastActivityAt,
  createdAt: records.createdAt,
  updatedAt: records.updatedAt,
  archivedAt: records.archivedAt,
};

type Row = {
  id: string;
  type: string;
  data: unknown;
  ownerId: string;
  version: number;
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

function toModel(row: Row): RecordModel {
  return {
    id: row.id,
    type: row.type,
    data: (row.data ?? {}) as Record<string, unknown>,
    ownerId: row.ownerId,
    version: row.version,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

interface Cursor {
  s: string | null;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}
function decodeCursor(raw: string): Cursor {
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
  } catch {
    throw AppError.validation("invalid cursor");
  }
}

function requireWorkspace(workspaceId: string | undefined): string {
  if (!workspaceId) throw AppError.invalidState("record reads require a workspace in context");
  return workspaceId;
}

export async function listRecords(input: ListRecordsInput): Promise<ListRecordsResult> {
  const typeDef = getRecordType(input.type);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  // Reads are workspace-scoped (D-020 open read): filter by workspace only, no
  // per-row visibility. RLS additionally isolates by org.
  const ctx = requestContext.require();
  const conditions: SQL[] = [
    eq(records.type, input.type),
    eq(records.workspaceId, requireWorkspace(ctx.workspaceId)),
  ];
  if (!input.includeArchived) conditions.push(isNull(records.archivedAt));
  if (input.filter) conditions.push(compileFilter(input.filter, typeDef));

  // Sort expression + a stable id tiebreaker for keyset pagination.
  const sortField = input.sort?.field;
  const dir = input.sort?.direction ?? "asc";
  const spec: SortSpec | null = sortField
    ? (COLUMN_SORTS[sortField] ?? dataSortExpr(typeDef, sortField))
    : null;

  if (input.cursor) {
    const cur = decodeCursor(input.cursor);
    conditions.push(keysetPredicate(spec, dir, cur));
  }

  const orderBy = spec
    ? sql`${spec.expr} ${sql.raw(dir)} NULLS LAST, id ${sql.raw(dir)}`
    : sql`id ${sql.raw(dir)}`;

  const rows = (await withTx((tx) =>
    tx
      .select(SELECT)
      .from(records)
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit + 1),
  )) as Row[];

  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ s: spec ? sortValue(last, sortField!) : null, id: last.id })
      : null;

  return { records: page.map(toModel), nextCursor };
}

function keysetPredicate(spec: SortSpec | null, dir: "asc" | "desc", cur: Cursor): SQL {
  const cmp = dir === "asc" ? sql.raw(">") : sql.raw("<");
  if (!spec) {
    return sql`id ${cmp} ${cur.id}`;
  }
  // Cast the cursor value to the sort expression's type so comparisons are typed.
  const param = cur.s === null ? sql`NULL` : sql`${cur.s}::${sql.raw(spec.pgType)}`;
  // (sortExpr, id) strictly after the cursor; ties broken by id.
  return sql`(${spec.expr} ${cmp} ${param} OR (${spec.expr} IS NOT DISTINCT FROM ${param} AND id ${cmp} ${cur.id}))`;
}

function sortValue(row: Row, field: string): string | null {
  if (field === "created_at") return row.createdAt.toISOString();
  if (field === "updated_at") return row.updatedAt.toISOString();
  if (field === "last_activity_at") return row.lastActivityAt?.toISOString() ?? null;
  if (field === "owner" || field === "owner_id") return row.ownerId;
  const v = (row.data as Record<string, unknown>)?.[field];
  return v === undefined || v === null ? null : String(v);
}

export async function getRecord(type: string, id: string): Promise<RecordModel | null> {
  getRecordType(type);
  const rows = (await withTx((tx) =>
    tx.select(SELECT).from(records).where(eq(records.id, id)).limit(1),
  )) as Row[];
  const row = rows[0];
  if (!row || row.type !== type) return null;
  return toModel(row);
}

/**
 * FTS over the generated `search` tsvector. Also backs relation-picker typeahead
 * (search within a single type).
 */
export async function searchRecords(input: {
  query: string;
  type?: string;
  limit?: number;
}): Promise<RecordModel[]> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const ctx = requestContext.require();
  const conditions: SQL[] = [
    eq(records.workspaceId, requireWorkspace(ctx.workspaceId)),
    isNull(records.archivedAt),
    sql`search @@ plainto_tsquery('english', ${input.query})`,
  ];
  if (input.type) {
    getRecordType(input.type);
    conditions.push(eq(records.type, input.type));
  }
  const rows = (await withTx((tx) =>
    tx
      .select(SELECT)
      .from(records)
      .where(and(...conditions))
      .limit(limit),
  )) as Row[];
  return rows.map(toModel);
}
