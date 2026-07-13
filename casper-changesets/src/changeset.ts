import { and, count, eq } from "drizzle-orm";
import {
  AppError,
  isAppError,
  newId,
  requestContext,
  withSystemTx,
  withTx,
  type Principal,
  type Tx,
} from "@casper/platform";
import { assertCan, schema as authSchema } from "@casper/auth";
import { dispatchPending, emit } from "@casper/events";
import { getRecord, getRecordType, validateRecordData } from "@casper/records";
import { getActiveVersion, workflowDefinitionSchema } from "@casper/workflow";
import { changes, changesetReviews, changesets } from "./schema.js";
import { computeRisk } from "./risk.js";
import {
  targetSchema,
  type AddChangeInput,
  type ChangeModel,
  type ChangeOp,
  type ChangeSetModel,
  type ChangeSetStatus,
  type ChangeTarget,
  type Origin,
  type ValidationResult,
} from "./types.js";

// ---- loading ----------------------------------------------------------------

function requireWorkspace(workspaceId: string | undefined): string {
  if (!workspaceId) throw AppError.invalidState("change sets require a workspace in context");
  return workspaceId;
}

function rowToChange(r: typeof changes.$inferSelect): ChangeModel {
  return {
    id: r.id,
    changesetId: r.changesetId,
    position: r.position,
    op: r.op as ChangeOp,
    target: r.target as ChangeTarget,
    payload: r.payload,
    baseVersion: r.baseVersion,
    risk: r.risk as ChangeModel["risk"],
    approval: r.approval as ChangeModel["approval"],
    validation: r.validation as ValidationResult,
    appliedAt: r.appliedAt?.toISOString() ?? null,
  };
}

async function loadChanges(tx: Tx, changesetId: string): Promise<ChangeModel[]> {
  const rows = await tx
    .select()
    .from(changes)
    .where(eq(changes.changesetId, changesetId))
    .orderBy(changes.position);
  return rows.map(rowToChange);
}

export async function getChangeSet(id: string): Promise<ChangeSetModel> {
  return withTx(async (tx) => {
    const rows = await tx.select().from(changesets).where(eq(changesets.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw AppError.notFound(`change set ${id} not found`);
    const changeList = await loadChanges(tx, id);
    return {
      id: row.id,
      orgId: row.orgId,
      workspaceId: row.workspaceId,
      author: {
        kind: row.authorKind as Principal["kind"],
        id: row.authorId,
        orgId: row.orgId,
        workspaceId: row.workspaceId,
      },
      origin: row.origin as Origin,
      title: row.title,
      intent: row.intent,
      status: row.status as ChangeSetStatus,
      changes: changeList,
    };
  });
}

// ---- lifecycle --------------------------------------------------------------

export async function createChangeSet(input: {
  title: string;
  intent?: string;
  origin: Origin;
}): Promise<ChangeSetModel> {
  const ctx = requestContext.require();
  const wsId = requireWorkspace(ctx.workspaceId);
  const id = newId();
  await withTx(async (tx) => {
    await tx.insert(changesets).values({
      id,
      orgId: ctx.orgId,
      workspaceId: wsId,
      authorKind: ctx.principal.kind,
      authorId: ctx.principal.id,
      origin: input.origin,
      title: input.title,
      intent: input.intent ?? null,
      status: "draft",
    });
    await emit(tx, {
      type: "changeset.created",
      subject: { type: "changeset", id },
      payload: { changesetId: id },
    });
  });
  await dispatchPending();
  return getChangeSet(id);
}

export async function addChange(
  changesetId: string,
  input: AddChangeInput,
): Promise<ChangeModel> {
  const ctx = requestContext.require();
  const cs = await getChangeSet(changesetId);
  if (cs.status !== "draft") {
    throw AppError.invalidState(`cannot add changes to a '${cs.status}' change set`);
  }
  const target = targetSchema.parse(input.target);

  // Publishing workflow config is `workflow.publish`-gated (admins/owner) at the
  // point the change is authored — only someone who may publish can stage one.
  if (input.op === "config_publish") {
    await assertCan(
      ctx.principal,
      "workflow.publish",
      { kind: "workspace", id: requireWorkspace(ctx.workspaceId) },
      { workspaceId: ctx.workspaceId },
    );
  }

  const validation = await validateChange(input.op, target, input.payload);
  const baseVersion = await computeBaseVersion(input.op, target);
  const risk = computeRisk(input.op, target, input.payload);
  const id = newId();

  await withTx((tx) =>
    tx.insert(changes).values({
      id,
      changesetId,
      orgId: ctx.orgId,
      workspaceId: requireWorkspace(ctx.workspaceId),
      position: cs.changes.length,
      op: input.op,
      target,
      payload: (input.payload ?? null) as unknown,
      baseVersion,
      risk,
      approval: "pending",
      validation,
    }),
  );

  return { ...rowToChangeSetChange(id, changesetId, cs.changes.length, input, target, baseVersion, risk, validation) };
}

function rowToChangeSetChange(
  id: string,
  changesetId: string,
  position: number,
  input: AddChangeInput,
  target: ChangeTarget,
  baseVersion: string | null,
  risk: ChangeModel["risk"],
  validation: ValidationResult,
): ChangeModel {
  return {
    id,
    changesetId,
    position,
    op: input.op,
    target,
    payload: input.payload ?? null,
    baseVersion,
    risk,
    approval: "pending",
    validation,
    appliedAt: null,
  };
}

export async function submitForReview(changesetId: string): Promise<void> {
  const cs = await getChangeSet(changesetId);
  if (cs.status !== "draft") {
    throw AppError.invalidState(`cannot submit a '${cs.status}' change set`);
  }
  await setStatus(changesetId, "in_review", "changeset.submitted");
}

export async function approveChange(
  changesetId: string,
  changeId: string,
  note?: string,
): Promise<void> {
  await review(changesetId, changeId, "approved", note);
}

export async function rejectChange(
  changesetId: string,
  changeId: string,
  note?: string,
): Promise<void> {
  await review(changesetId, changeId, "rejected", note);
}

/** Approve every still-pending change (respecting the per-change gates). */
export async function approveAll(changesetId: string): Promise<void> {
  const cs = await getChangeSet(changesetId);
  for (const c of cs.changes) {
    if (c.approval === "pending") await approveChange(changesetId, c.id);
  }
}

async function review(
  changesetId: string,
  changeId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<void> {
  const ctx = requestContext.require();
  const cs = await getChangeSet(changesetId);
  const change = cs.changes.find((c) => c.id === changeId);
  if (!change) throw AppError.notFound(`change ${changeId} not found`);

  await assertCan(
    ctx.principal,
    "changeset.approve",
    { kind: "changeset", authorId: cs.author.id, workspaceId: cs.workspaceId },
    { workspaceId: cs.workspaceId },
  );

  // No self-approval of high-risk changes in multi-seat orgs (D-006); single-seat
  // dogfood orgs are exempt (D-017). AI-authored sets approved by the requesting
  // user are review, not self-approval, so this only bites a human approving own work.
  if (
    decision === "approved" &&
    change.risk === "high" &&
    ctx.principal.kind === "user" &&
    cs.author.id === ctx.principal.id
  ) {
    const seats = await activeSeatCount(cs.workspaceId);
    if (seats > 1) {
      throw AppError.permissionDenied("high-risk change requires a different approver", { changeId });
    }
  }

  await withTx(async (tx) => {
    await tx.update(changes).set({ approval: decision }).where(eq(changes.id, changeId));
    await tx.insert(changesetReviews).values({
      id: newId(),
      changesetId,
      orgId: ctx.orgId,
      workspaceId: cs.workspaceId,
      changeId,
      reviewerKind: ctx.principal.kind,
      reviewerId: ctx.principal.id,
      decision,
      note: note ?? null,
    });
  });

  await maybeMarkDecided(changesetId);
}

/** Once every change is decided, move the set to `approved` (commit applies the approved subset). */
async function maybeMarkDecided(changesetId: string): Promise<void> {
  const cs = await getChangeSet(changesetId);
  if (cs.changes.some((c) => c.approval === "pending")) return;
  const anyApproved = cs.changes.some((c) => c.approval === "approved");
  await setStatus(changesetId, "approved", anyApproved ? "changeset.approved" : "changeset.rejected");
}

// ---- helpers ----------------------------------------------------------------

export async function setStatus(
  changesetId: string,
  status: ChangeSetStatus,
  eventType?: string,
): Promise<void> {
  await withTx(async (tx) => {
    await tx
      .update(changesets)
      .set({ status, updatedAt: new Date() })
      .where(eq(changesets.id, changesetId));
    if (eventType) {
      await emit(tx, {
        type: eventType,
        subject: { type: "changeset", id: changesetId },
        payload: { changesetId, status },
      });
    }
  });
  if (eventType) await dispatchPending();
}

async function activeSeatCount(workspaceId: string): Promise<number> {
  const rows = await withSystemTx((tx) =>
    tx
      .select({ c: count() })
      .from(authSchema.memberships)
      .where(
        and(
          eq(authSchema.memberships.workspaceId, workspaceId),
          eq(authSchema.memberships.status, "active"),
        ),
      ),
  );
  return Number(rows[0]?.c ?? 0);
}

function okV(): ValidationResult {
  return { ok: true, issues: [] };
}

async function validateChange(
  op: ChangeOp,
  target: ChangeTarget,
  payload: unknown,
): Promise<ValidationResult> {
  try {
    if (op === "config_publish") {
      const r = workflowDefinitionSchema.safeParse(payload);
      return r.success
        ? okV()
        : { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
    }
    if (target.kind === "record" && (op === "create" || op === "update")) {
      const typeDef = getRecordType(target.type);
      validateRecordData(typeDef, (payload ?? {}) as Record<string, unknown>, {
        partial: op === "update",
      });
      return okV();
    }
    if (op === "transition") {
      const p = payload as { toStage?: unknown } | null;
      if (typeof p?.toStage !== "string") {
        return { ok: false, issues: [{ path: "toStage", message: "toStage is required" }] };
      }
      return okV();
    }
    return okV();
  } catch (e) {
    if (isAppError(e) && e.code === "validation_failed") {
      const details = (e.details as { path: string; message: string }[] | undefined) ?? [];
      return { ok: false, issues: details.length ? details : [{ path: "", message: e.message }] };
    }
    throw e;
  }
}

async function computeBaseVersion(op: ChangeOp, target: ChangeTarget): Promise<string | null> {
  if (target.kind === "record" && target.id && (op === "update" || op === "transition" || op === "delete")) {
    const rec = await getRecord(target.type, target.id);
    return rec ? String(rec.version) : null;
  }
  if (op === "config_publish" && target.kind === "config" && target.recordType) {
    const v = getActiveVersion(target.recordType);
    return v !== undefined ? String(v) : null;
  }
  return null;
}
