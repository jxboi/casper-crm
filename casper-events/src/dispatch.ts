import { asc, eq, isNull } from "drizzle-orm";
import { now, withSystemTx, type Principal, type Tx } from "@casper/platform";
import { domainEvents, auditLog, timelineEntries } from "./schema.js";
import { consumersFor, on } from "./registry.js";
import type { DomainEvent } from "./envelope.js";

/**
 * Post-commit fan-out. In production this is triggered by `waitUntil` after the
 * write plus a sweeper cron for anything a crash left behind (D-019); in dev/test
 * it is called synchronously after the write transaction so projections are
 * immediately queryable. Delivery is at-least-once and projectors are idempotent
 * (keyed by event id), so redelivery is safe.
 */
export async function dispatchPending(limit = 500): Promise<number> {
  return withSystemTx(async (tx) => {
    const rows = await tx
      .select()
      .from(domainEvents)
      .where(isNull(domainEvents.dispatchedAt))
      .orderBy(asc(domainEvents.id))
      .limit(limit);

    for (const row of rows) {
      const event = rowToEvent(row);
      for (const handler of consumersFor(event.type)) {
        await handler(event, tx);
      }
      await tx
        .update(domainEvents)
        .set({ dispatchedAt: now() })
        .where(eq(domainEvents.id, row.id));
    }
    return rows.length;
  });
}

function rowToEvent(row: typeof domainEvents.$inferSelect): DomainEvent {
  const actor: Principal = {
    kind: row.actorKind as Principal["kind"],
    id: row.actorId,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
  };
  return {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    type: row.type,
    subject: { type: row.subjectType, id: row.subjectId },
    actor,
    source: row.source as DomainEvent["source"],
    payload: row.payload,
    occurredAt: row.occurredAt.toISOString(),
    correlationId: row.correlationId,
    causationId: row.causationId ?? undefined,
  };
}

// ---- Built-in projectors (audit + timeline). Named so they survive test resets.

async function auditProjector(event: DomainEvent, tx: Tx): Promise<void> {
  await tx
    .insert(auditLog)
    .values({
      eventId: event.id,
      orgId: event.orgId,
      workspaceId: event.workspaceId,
      type: event.type,
      subjectType: event.subject.type,
      subjectId: event.subject.id,
      actorKind: event.actor.kind,
      actorId: event.actor.id,
      source: event.source,
      payload: event.payload as unknown,
      occurredAt: new Date(event.occurredAt),
    })
    .onConflictDoNothing();
}

interface FieldDiff {
  field: string;
  before?: unknown;
  after?: unknown;
}

function timelineSummary(event: DomainEvent): { kind: string; summary: string } {
  const kind = event.type.split(".").pop() ?? event.type;
  const payload = (event.payload ?? {}) as { diff?: FieldDiff[] };
  switch (kind) {
    case "created":
      return { kind, summary: `${event.subject.type} created` };
    case "archived":
      return { kind, summary: `${event.subject.type} archived` };
    case "updated": {
      const fields = payload.diff?.map((d) => d.field) ?? [];
      return {
        kind,
        summary: fields.length ? `Updated ${fields.join(", ")}` : "Updated",
      };
    }
    default:
      return { kind, summary: event.type };
  }
}

async function timelineProjector(event: DomainEvent, tx: Tx): Promise<void> {
  const { kind, summary } = timelineSummary(event);
  await tx
    .insert(timelineEntries)
    .values({
      eventId: event.id,
      orgId: event.orgId,
      workspaceId: event.workspaceId,
      recordType: event.subject.type,
      recordId: event.subject.id,
      kind,
      actorKind: event.actor.kind,
      actorId: event.actor.id,
      summary,
      data: event.payload as unknown,
      occurredAt: new Date(event.occurredAt),
    })
    .onConflictDoNothing();
}

// Register once at module load. These are audit-grade projections of *every*
// domain event, so they subscribe to the wildcard pattern.
on("*", auditProjector, "builtin:audit");
on("*", timelineProjector, "builtin:timeline");

export const BUILTIN_CONSUMER_NAMES = ["builtin:audit", "builtin:timeline"];
