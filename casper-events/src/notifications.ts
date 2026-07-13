import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { newId, now, requestContext, withTx, type Tx } from "@casper/platform";
import { notifications } from "./schema.js";
import { on } from "./registry.js";
import type { DomainEvent } from "./envelope.js";

/**
 * In-app notifications (events plan P0). Notifications are *consumers* of the
 * domain stream, not a side effect of the emitter — so a new notification rule
 * is added here without touching any write path. P0 ships two rules: **mention**
 * (someone @mentions you in a comment) and **task assigned** (a Task's assignee
 * becomes you). Both are idempotent under at-least-once redelivery via the
 * `(sourceEventId, userId, type)` unique index.
 *
 * Email delivery + a per-user preference matrix are Phase 1c (in-app is enough
 * for the single dogfood user, D-017); this is the in-app inbox they build on.
 */
export interface NotificationModel {
  id: string;
  type: string;
  title: string;
  body: string | null;
  subject: { type: string; id: string } | null;
  data: unknown;
  readAt: string | null;
  createdAt: string;
}

interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  subject?: { type: string; id: string };
  data?: Record<string, unknown>;
}

/**
 * Insert on the dispatch tx (system, RLS bypassed) with org/workspace copied from
 * the event. `onConflictDoNothing` on the dedupe index makes redelivery a no-op.
 */
async function insertNotification(
  tx: Tx,
  event: DomainEvent,
  input: NotificationInput,
): Promise<void> {
  await tx
    .insert(notifications)
    .values({
      id: newId(),
      orgId: event.orgId,
      workspaceId: event.workspaceId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      subjectType: input.subject?.type ?? null,
      subjectId: input.subject?.id ?? null,
      sourceEventId: event.id,
      data: input.data ?? {},
      createdAt: now(),
    })
    .onConflictDoNothing();
}

// ---- Rules ------------------------------------------------------------------

/** @mention in a comment → notify each mentioned teammate (never the author). */
async function notifyMentions(event: DomainEvent, tx: Tx): Promise<void> {
  const payload = (event.payload ?? {}) as { mentions?: string[] };
  const mentions = payload.mentions ?? [];
  for (const userId of mentions) {
    if (userId === event.actor.id) continue;
    await insertNotification(tx, event, {
      userId,
      type: "mention",
      title: "You were mentioned in a comment",
      subject: event.subject,
      data: { commentId: (event.payload as { commentId?: string }).commentId },
    });
  }
}

interface FieldDiff {
  field: string;
  before?: unknown;
  after?: unknown;
}

/** Pull the (new) assignee from a task.created / task.updated payload, if any. */
function assigneeFromTaskEvent(event: DomainEvent): string | undefined {
  if (event.type === "task.created") {
    const data = (event.payload as { data?: Record<string, unknown> }).data ?? {};
    const a = data.assignee;
    return typeof a === "string" ? a : undefined;
  }
  if (event.type === "task.updated") {
    const diff = (event.payload as { diff?: FieldDiff[] }).diff ?? [];
    const entry = diff.find((d) => d.field === "assignee");
    return entry && typeof entry.after === "string" ? entry.after : undefined;
  }
  return undefined;
}

/** Task assigned to you → notify (unless you assigned it to yourself). */
async function notifyTaskAssigned(event: DomainEvent, tx: Tx): Promise<void> {
  const assignee = assigneeFromTaskEvent(event);
  if (!assignee || assignee === event.actor.id) return;
  await insertNotification(tx, event, {
    userId: assignee,
    type: "task_assigned",
    title: "A task was assigned to you",
    subject: event.subject,
  });
}

on("comment.created", notifyMentions, "builtin:notify-mentions");
on("task.created", notifyTaskAssigned, "builtin:notify-task-assigned:created");
on("task.updated", notifyTaskAssigned, "builtin:notify-task-assigned:updated");

export const NOTIFICATION_CONSUMER_NAMES = [
  "builtin:notify-mentions",
  "builtin:notify-task-assigned:created",
  "builtin:notify-task-assigned:updated",
];

// ---- Inbox queries (recipient = current principal) --------------------------

function toModel(row: typeof notifications.$inferSelect): NotificationModel {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    subject: row.subjectType && row.subjectId
      ? { type: row.subjectType, id: row.subjectId }
      : null,
    data: row.data,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotifications(
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationModel[]> {
  const ctx = requestContext.require();
  return withTx(async (tx) => {
    const where = opts.unreadOnly
      ? and(eq(notifications.userId, ctx.principal.id), isNull(notifications.readAt))
      : eq(notifications.userId, ctx.principal.id);
    const rows = await tx
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(opts.limit ?? 100);
    return rows.map(toModel);
  });
}

export async function unreadCount(): Promise<number> {
  const ctx = requestContext.require();
  return withTx(async (tx) => {
    const rows = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(eq(notifications.userId, ctx.principal.id), isNull(notifications.readAt)),
      );
    return rows.length;
  });
}

/** Mark the given notifications read. Only the recipient's own rows are touched. */
export async function markRead(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const ctx = requestContext.require();
  return withTx(async (tx) => {
    const rows = await tx
      .update(notifications)
      .set({ readAt: now() })
      .where(
        and(
          eq(notifications.userId, ctx.principal.id),
          isNull(notifications.readAt),
          inArray(notifications.id, ids),
        ),
      )
      .returning({ id: notifications.id });
    return rows.length;
  });
}

export async function markAllRead(): Promise<number> {
  const ctx = requestContext.require();
  return withTx(async (tx) => {
    const rows = await tx
      .update(notifications)
      .set({ readAt: now() })
      .where(
        and(eq(notifications.userId, ctx.principal.id), isNull(notifications.readAt)),
      )
      .returning({ id: notifications.id });
    return rows.length;
  });
}
