import { and, eq, or } from "drizzle-orm";
import { AppError, newId, requestContext, withTx } from "@casper/platform";
import { assertCan } from "@casper/auth";
import { savedViews } from "./schema.js";
import { getRecordType } from "./registry.js";
import { listRecords, type ListRecordsResult, type Sort } from "./query.js";
import type { Filter } from "./filter.js";

/**
 * Saved views (records plan): a named Filter AST + sort + visible columns + layout,
 * personal or shared, per record type. `renderView` runs the view through the same
 * `listRecords` path so views, automations, and assistant queries share one engine.
 */
export type ViewLayout =
  | { kind: "table" }
  | { kind: "board"; groupByField: string }
  | { kind: "list" };

export interface SavedViewModel {
  id: string;
  recordType: string;
  name: string;
  scope: "personal" | "shared";
  ownerId: string | null;
  filter: Filter | null;
  sort: Sort | null;
  columns: string[] | null;
  layout: ViewLayout | null;
}

export interface CreateViewInput {
  recordType: string;
  name: string;
  scope?: "personal" | "shared";
  filter?: Filter;
  sort?: Sort;
  columns?: string[];
  layout?: ViewLayout;
}

export async function createSavedView(input: CreateViewInput): Promise<SavedViewModel> {
  const ctx = requestContext.require();
  getRecordType(input.recordType);
  await assertCan(
    ctx.principal,
    "view.create",
    { kind: "record", type: input.recordType, workspaceId: ctx.workspaceId },
    { workspaceId: ctx.workspaceId },
  );
  const scope = input.scope ?? "personal";
  const id = newId();
  await withTx((tx) =>
    tx.insert(savedViews).values({
      id,
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId ?? "",
      recordType: input.recordType,
      name: input.name,
      scope,
      ownerId: scope === "personal" ? ctx.principal.id : null,
      filter: input.filter ?? null,
      sort: input.sort ?? null,
      columns: input.columns ?? null,
      layout: input.layout ?? null,
    }),
  );
  return {
    id,
    recordType: input.recordType,
    name: input.name,
    scope,
    ownerId: scope === "personal" ? ctx.principal.id : null,
    filter: input.filter ?? null,
    sort: input.sort ?? null,
    columns: input.columns ?? null,
    layout: input.layout ?? null,
  };
}

/** Views visible to the actor for a type: shared views + the actor's personal ones. */
export async function listSavedViews(recordType: string): Promise<SavedViewModel[]> {
  const ctx = requestContext.require();
  getRecordType(recordType);
  const rows = await withTx((tx) =>
    tx
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.recordType, recordType),
          or(eq(savedViews.scope, "shared"), eq(savedViews.ownerId, ctx.principal.id)),
        ),
      ),
  );
  return rows.map(rowToModel);
}

export async function renderView(
  viewId: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<ListRecordsResult> {
  const ctx = requestContext.require();
  const rows = await withTx((tx) =>
    tx.select().from(savedViews).where(eq(savedViews.id, viewId)).limit(1),
  );
  const view = rows[0];
  if (!view) throw AppError.notFound(`view ${viewId} not found`);
  // Personal views are private to their owner.
  if (view.scope === "personal" && view.ownerId !== ctx.principal.id) {
    throw AppError.permissionDenied("view is personal to another user");
  }
  const model = rowToModel(view);
  return listRecords({
    type: model.recordType,
    filter: model.filter ?? undefined,
    sort: model.sort ?? undefined,
    limit: opts.limit,
    cursor: opts.cursor,
  });
}

function rowToModel(row: typeof savedViews.$inferSelect): SavedViewModel {
  return {
    id: row.id,
    recordType: row.recordType,
    name: row.name,
    scope: row.scope as "personal" | "shared",
    ownerId: row.ownerId,
    filter: (row.filter as Filter | null) ?? null,
    sort: (row.sort as Sort | null) ?? null,
    columns: (row.columns as string[] | null) ?? null,
    layout: (row.layout as ViewLayout | null) ?? null,
  };
}
