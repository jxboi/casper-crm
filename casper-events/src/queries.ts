import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { withTx } from "@casper/platform";
import { auditLog, comments, timelineEntries } from "./schema.js";
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

function commentSummary(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > 140 ? `${oneLine.slice(0, 139)}…` : oneLine;
}

/**
 * The record timeline: projected domain events merged with live comments. Comments
 * come from their own table (not `timeline_entries`) so edits/deletes are always
 * reflected without replaying raw events. Both sides are already per-record and
 * indexed, so this is a bounded merge, not an on-the-fly join over the event log.
 */
export async function getTimeline(
  ref: SubjectRef,
  opts: { limit?: number } = {},
): Promise<TimelineEntry[]> {
  const limit = opts.limit ?? 200;
  return withTx(async (tx) => {
    const eventRows = await tx
      .select()
      .from(timelineEntries)
      .where(
        and(
          eq(timelineEntries.recordType, ref.type),
          eq(timelineEntries.recordId, ref.id),
        ),
      )
      .orderBy(asc(timelineEntries.occurredAt))
      .limit(limit);

    const commentRows = await tx
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.recordType, ref.type),
          eq(comments.recordId, ref.id),
          isNull(comments.deletedAt),
        ),
      )
      .orderBy(asc(comments.createdAt))
      .limit(limit);

    const entries: TimelineEntry[] = [
      ...eventRows.map((r) => ({
        eventId: r.eventId,
        recordType: r.recordType,
        recordId: r.recordId,
        kind: r.kind,
        actorKind: r.actorKind,
        actorId: r.actorId,
        summary: r.summary,
        data: r.data,
        occurredAt: r.occurredAt.toISOString(),
      })),
      ...commentRows.map((c) => ({
        eventId: `comment:${c.id}`,
        recordType: c.recordType,
        recordId: c.recordId,
        kind: "comment",
        actorKind: "user",
        actorId: c.authorId,
        summary: commentSummary(c.body),
        data: {
          commentId: c.id,
          body: c.body,
          mentions: c.mentions,
          editedAt: c.editedAt?.toISOString() ?? null,
        },
        occurredAt: c.createdAt.toISOString(),
      })),
    ];

    entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    return entries.slice(0, limit);
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
