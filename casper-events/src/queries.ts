import { and, asc, desc, eq } from "drizzle-orm";
import { withTx } from "@casper/platform";
import { auditLog, timelineEntries } from "./schema.js";
import type { SubjectRef } from "./envelope.js";

/**
 * Read the projections. Tenant-scoped (RLS applies via `withTx`): a member reads
 * timeline/audit only for their own org.
 */
export interface TimelineEntry {
  eventId: string;
  recordType: string;
  recordId: string;
  kind: string;
  actorKind: string;
  actorId: string;
  summary: string;
  data: unknown;
  occurredAt: string;
}

export async function getTimeline(
  ref: SubjectRef,
  opts: { limit?: number } = {},
): Promise<TimelineEntry[]> {
  return withTx(async (tx) => {
    const rows = await tx
      .select()
      .from(timelineEntries)
      .where(
        and(
          eq(timelineEntries.recordType, ref.type),
          eq(timelineEntries.recordId, ref.id),
        ),
      )
      .orderBy(asc(timelineEntries.occurredAt))
      .limit(opts.limit ?? 200);
    return rows.map((r) => ({
      eventId: r.eventId,
      recordType: r.recordType,
      recordId: r.recordId,
      kind: r.kind,
      actorKind: r.actorKind,
      actorId: r.actorId,
      summary: r.summary,
      data: r.data,
      occurredAt: r.occurredAt.toISOString(),
    }));
  });
}

export interface AuditEntry {
  eventId: string;
  type: string;
  subjectType: string;
  subjectId: string;
  actorKind: string;
  actorId: string;
  source: string;
  occurredAt: string;
}

export async function getAuditLog(
  filter: { subject?: SubjectRef; limit?: number } = {},
): Promise<AuditEntry[]> {
  return withTx(async (tx) => {
    const where = filter.subject
      ? and(
          eq(auditLog.subjectType, filter.subject.type),
          eq(auditLog.subjectId, filter.subject.id),
        )
      : undefined;
    const rows = await tx
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.occurredAt))
      .limit(filter.limit ?? 200);
    return rows.map((r) => ({
      eventId: r.eventId,
      type: r.type,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      actorKind: r.actorKind,
      actorId: r.actorId,
      source: r.source,
      occurredAt: r.occurredAt.toISOString(),
    }));
  });
}
