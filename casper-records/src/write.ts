import { and, eq } from "drizzle-orm";
import {
  AppError,
  newId,
  now,
  requestContext,
  withTx,
  type Principal,
  type Tx,
} from "@casper/platform";
import { assertCan } from "@casper/auth";
import { emit, dispatchPending } from "@casper/events";
import { records } from "./schema.js";
import { getRecordType } from "./registry.js";
import { applyDefaults, validateRecordData } from "./validation.js";
import { syncRelations } from "./relations.js";
import type { RecordTypeDef } from "./field-types.js";

/**
 * THE single write path (records plan — "There is exactly one write path").
 * UI edits, imports, automations, and change-set commits all call these functions,
 * so validation, permissions, and events can never be bypassed. Every write is:
 *   can() → validate → persist (+ version bump) → emit domain event (in the same
 *   tx) → dispatch. A grep for INSERT/UPDATE on `records` should find only this file.
 */
export interface RecordModel {
  id: string;
  type: string;
  data: Record<string, unknown>;
  ownerId: string;
  version: number;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
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

async function loadRow(tx: Tx, type: string, id: string): Promise<Row> {
  const rows = await tx.select(SELECT).from(records).where(eq(records.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.type !== type) {
    throw AppError.notFound(`record ${type}/${id} not found`);
  }
  return row as Row;
}

function actor(): Principal {
  return requestContext.require().principal;
}

// ---- create -----------------------------------------------------------------

export interface CreateRecordInput {
  type: string;
  data: Record<string, unknown>;
  /** Defaults to the acting principal. */
  ownerId?: string;
}

export async function createRecord(input: CreateRecordInput): Promise<RecordModel> {
  const ctx = requestContext.require();
  const typeDef = getRecordType(input.type);
  const ownerId = input.ownerId ?? ctx.principal.id;

  await assertCan(
    ctx.principal,
    "record.create",
    { kind: "record", type: input.type, ownerId, workspaceId: ctx.workspaceId },
    { workspaceId: ctx.workspaceId },
  );

  const withDefaults = applyDefaults(typeDef, input.data);
  const data = validateRecordData(typeDef, withDefaults);

  const id = newId();
  const ts = now();

  const model = await withTx(async (tx) => {
    const rows = await tx
      .insert(records)
      .values({
        id,
        orgId: ctx.orgId,
        workspaceId: requireWorkspace(ctx.workspaceId),
        type: input.type,
        data,
        ownerId,
        version: 1,
        lastActivityAt: ts,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning(SELECT);

    await syncRelations(tx, typeDef, id, data);

    await emit(tx, {
      type: `${input.type}.created`,
      subject: { type: input.type, id },
      payload: { data, ownerId },
    });
    return toModel(rows[0] as Row);
  });

  await dispatchPending();
  return model;
}

// ---- update -----------------------------------------------------------------

export interface UpdateRecordInput {
  type: string;
  id: string;
  /** Partial patch — only provided keys change (field-mask-aware). */
  patch: Record<string, unknown>;
  /** Optimistic-concurrency token; when set, a mismatch throws `conflict`. */
  baseVersion?: number;
}

export async function updateRecord(input: UpdateRecordInput): Promise<RecordModel> {
  const ctx = requestContext.require();
  const typeDef = getRecordType(input.type);

  const existing = await withTx((tx) => loadRow(tx, input.type, input.id));
  assertVersion(input.baseVersion, existing.version);

  await assertCan(
    ctx.principal,
    "record.update",
    { kind: "record", type: input.type, id: input.id, ownerId: existing.ownerId, workspaceId: ctx.workspaceId },
    { workspaceId: ctx.workspaceId },
  );

  const before = (existing.data ?? {}) as Record<string, unknown>;
  // Validate the patch against the partial schema, then the merged result in full.
  validateRecordData(typeDef, input.patch, { partial: true });
  const merged = { ...before, ...input.patch };
  validateRecordData(typeDef, merged);

  const diff = diffFields(input.patch, before);
  if (diff.length === 0) return toModel(existing);

  const ts = now();
  const model = await withTx(async (tx) => {
    const rows = await tx
      .update(records)
      .set({ data: merged, version: existing.version + 1, updatedAt: ts })
      .where(and(eq(records.id, input.id), eq(records.version, existing.version)))
      .returning(SELECT);
    if (rows.length === 0) {
      // Someone else bumped the version between our read and write.
      throw AppError.conflict(`record ${input.type}/${input.id} was modified concurrently`);
    }
    if (touchesRelations(typeDef, input.patch)) {
      await syncRelations(tx, typeDef, input.id, merged);
    }
    await emit(tx, {
      type: `${input.type}.updated`,
      subject: { type: input.type, id: input.id },
      payload: { diff },
    });
    return toModel(rows[0] as Row);
  });

  await dispatchPending();
  return model;
}

// ---- archive ----------------------------------------------------------------

export interface ArchiveRecordInput {
  type: string;
  id: string;
  baseVersion?: number;
}

export async function archiveRecord(input: ArchiveRecordInput): Promise<RecordModel> {
  const ctx = requestContext.require();
  getRecordType(input.type);

  const existing = await withTx((tx) => loadRow(tx, input.type, input.id));
  if (existing.archivedAt) return toModel(existing);
  assertVersion(input.baseVersion, existing.version);

  await assertCan(
    ctx.principal,
    "record.archive",
    { kind: "record", type: input.type, id: input.id, ownerId: existing.ownerId, workspaceId: ctx.workspaceId },
    { workspaceId: ctx.workspaceId },
  );

  const ts = now();
  const model = await withTx(async (tx) => {
    const rows = await tx
      .update(records)
      .set({ archivedAt: ts, version: existing.version + 1, updatedAt: ts })
      .where(and(eq(records.id, input.id), eq(records.version, existing.version)))
      .returning(SELECT);
    if (rows.length === 0) {
      throw AppError.conflict(`record ${input.type}/${input.id} was modified concurrently`);
    }
    await emit(tx, {
      type: `${input.type}.archived`,
      subject: { type: input.type, id: input.id },
      payload: {},
    });
    return toModel(rows[0] as Row);
  });

  await dispatchPending();
  return model;
}

// ---- ownership --------------------------------------------------------------

export interface TransitionOwnerInput {
  type: string;
  id: string;
  newOwnerId: string;
  baseVersion?: number;
}

export async function transitionOwner(input: TransitionOwnerInput): Promise<RecordModel> {
  const ctx = requestContext.require();
  getRecordType(input.type);

  const existing = await withTx((tx) => loadRow(tx, input.type, input.id));
  assertVersion(input.baseVersion, existing.version);

  // Reassigning ownership is an update on the record.
  await assertCan(
    ctx.principal,
    "record.update",
    { kind: "record", type: input.type, id: input.id, ownerId: existing.ownerId, workspaceId: ctx.workspaceId },
    { workspaceId: ctx.workspaceId },
  );

  if (existing.ownerId === input.newOwnerId) return toModel(existing);

  const ts = now();
  const model = await withTx(async (tx) => {
    const rows = await tx
      .update(records)
      .set({ ownerId: input.newOwnerId, version: existing.version + 1, updatedAt: ts })
      .where(and(eq(records.id, input.id), eq(records.version, existing.version)))
      .returning(SELECT);
    if (rows.length === 0) {
      throw AppError.conflict(`record ${input.type}/${input.id} was modified concurrently`);
    }
    await emit(tx, {
      type: `${input.type}.owner_changed`,
      subject: { type: input.type, id: input.id },
      payload: { diff: [{ field: "owner", before: existing.ownerId, after: input.newOwnerId }] },
    });
    return toModel(rows[0] as Row);
  });

  await dispatchPending();
  return model;
}

/**
 * Bulk reassignment — the offboarding path (D-024, "reassign all to X"). Each
 * record is authorized individually so partial-permission actors reassign only
 * what they may.
 */
export async function bulkTransitionOwner(input: {
  type: string;
  ids: string[];
  newOwnerId: string;
}): Promise<RecordModel[]> {
  const out: RecordModel[] = [];
  for (const id of input.ids) {
    out.push(await transitionOwner({ type: input.type, id, newOwnerId: input.newOwnerId }));
  }
  return out;
}

// ---- helpers ----------------------------------------------------------------

function assertVersion(baseVersion: number | undefined, current: number): void {
  if (baseVersion !== undefined && baseVersion !== current) {
    throw AppError.conflict(
      `stale version: expected ${current}, got ${baseVersion}`,
      { current, provided: baseVersion },
    );
  }
}

function diffFields(patch: Record<string, unknown>, before: Record<string, unknown>): FieldDiff[] {
  const diff: FieldDiff[] = [];
  for (const [field, after] of Object.entries(patch)) {
    if (!deepEqual(before[field], after)) {
      diff.push({ field, before: before[field] ?? null, after: after ?? null });
    }
  }
  return diff;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function requireWorkspace(workspaceId: string | undefined): string {
  if (!workspaceId) throw AppError.invalidState("record writes require a workspace in context");
  return workspaceId;
}

function touchesRelations(type: RecordTypeDef, patch: Record<string, unknown>): boolean {
  return type.fields.some((f) => f.type === "relation" && f.key in patch);
}
