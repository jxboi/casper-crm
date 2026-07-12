import { and, eq } from "drizzle-orm";
import { newId, requestContext, withTx, type Tx } from "@casper/platform";
import { relations } from "./schema.js";
import type { RecordTypeDef } from "./field-types.js";

/**
 * Typed relations (records plan). Relation field values live in `data` for cheap
 * reads, and are mirrored into the `relations` join table so reverse lookups,
 * relation-picker typeahead, and (later) cascade rules have an indexed edge list.
 * Called inside the write transaction so the edge list stays consistent with data.
 */
export async function syncRelations(
  tx: Tx,
  type: RecordTypeDef,
  fromId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const ctx = requestContext.require();
  const relationFields = type.fields.filter((f) => f.type === "relation" && f.relation);
  for (const field of relationFields) {
    const spec = field.relation!;
    const raw = data[field.key];
    const toIds = spec.cardinality === "many" ? asArray(raw) : raw ? [String(raw)] : [];

    // Replace the edge set for this (fromId, fieldKey).
    await tx
      .delete(relations)
      .where(and(eq(relations.fromId, fromId), eq(relations.fieldKey, field.key)));

    for (const toId of toIds) {
      await tx.insert(relations).values({
        id: newId(),
        orgId: ctx.orgId,
        workspaceId: ctx.workspaceId ?? "",
        fromType: type.key,
        fromId,
        fieldKey: field.key,
        toType: spec.targetType,
        toId,
      });
    }
  }
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

/** Records related to `id` via any relation field (reverse-lookup friendly). */
export async function getRelated(
  fromType: string,
  fromId: string,
): Promise<{ fieldKey: string; toType: string; toId: string }[]> {
  return withTx(async (tx) => {
    const rows = await tx
      .select({
        fieldKey: relations.fieldKey,
        toType: relations.toType,
        toId: relations.toId,
      })
      .from(relations)
      .where(and(eq(relations.fromType, fromType), eq(relations.fromId, fromId)));
    return rows;
  });
}

/** Records that point *at* `toId` (e.g. deals whose primary contact is X). */
export async function getReferencing(
  toType: string,
  toId: string,
): Promise<{ fromType: string; fromId: string; fieldKey: string }[]> {
  return withTx(async (tx) => {
    return tx
      .select({
        fromType: relations.fromType,
        fromId: relations.fromId,
        fieldKey: relations.fieldKey,
      })
      .from(relations)
      .where(and(eq(relations.toType, toType), eq(relations.toId, toId)));
  });
}
