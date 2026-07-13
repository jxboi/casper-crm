import { pgTable, uuid, text, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";

/**
 * Event tables (events plan "data model sketch"). `domain_events` is the
 * transactional outbox — rows are written in the same `withTx` as the mutation
 * (D-005) and dispatched after commit. `audit_log` and `timeline_entries` are
 * rebuildable projections keyed by event id, so redelivery is idempotent.
 */
export const domainEvents = pgTable(
  "domain_events",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    type: text("type").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: uuid("actor_id").notNull(),
    source: text("source").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    correlationId: uuid("correlation_id").notNull(),
    causationId: uuid("causation_id"),
    // NULL until dispatched — the sweeper/drain predicate (at-least-once).
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    undispatchedIdx: index("domain_events_undispatched_idx").on(t.dispatchedAt, t.id),
    subjectIdx: index("domain_events_subject_idx").on(t.subjectType, t.subjectId),
  }),
);

export const auditLog = pgTable(
  "audit_log",
  {
    eventId: uuid("event_id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    type: text("type").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: uuid("actor_id").notNull(),
    source: text("source").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    subjectIdx: index("audit_log_subject_idx").on(t.subjectType, t.subjectId),
  }),
);

export const timelineEntries = pgTable(
  "timeline_entries",
  {
    eventId: uuid("event_id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    recordType: text("record_type").notNull(),
    recordId: text("record_id").notNull(),
    kind: text("kind").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: uuid("actor_id").notNull(),
    summary: text("summary").notNull(),
    data: jsonb("data").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    recordIdx: index("timeline_record_idx").on(t.recordType, t.recordId, t.occurredAt),
  }),
);

export const interactionEvents = pgTable("interaction_events", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  type: text("type").notNull(),
  actorKind: text("actor_kind").notNull(),
  actorId: uuid("actor_id").notNull(),
  subjectType: text("subject_type"),
  subjectId: text("subject_id"),
  data: jsonb("data").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
});

/**
 * Comments are timeline-native authored entries (events plan) — their own source
 * of truth so edit/delete stay live, unlike the append-only `domain_events`.
 * Every write also emits a `comment.*` domain event (audit + mention fan-out),
 * but the record timeline reads comments from *this* table so edits/deletes show
 * immediately without replaying raw events. `mentions` holds resolved user ids.
 * `deletedAt` is a soft delete so the audit trail (and the create event) survive.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    recordType: text("record_type").notNull(),
    recordId: text("record_id").notNull(),
    authorId: uuid("author_id").notNull(),
    body: text("body").notNull(),
    mentions: jsonb("mentions").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    recordIdx: index("comments_record_idx").on(t.recordType, t.recordId, t.createdAt),
  }),
);

/**
 * In-app notification inbox (events plan P0 — mention, task assigned). A consumer
 * of the domain stream inserts rows; the recipient reads/marks them. `readAt` NULL
 * = unread. `sourceEventId` + type + user is unique so at-least-once redelivery of
 * the producing event never double-notifies (idempotent, like the projections).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    sourceEventId: uuid("source_event_id").notNull(),
    data: jsonb("data").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    inboxIdx: index("notifications_inbox_idx").on(t.userId, t.readAt, t.createdAt),
    dedupe: unique("notifications_dedupe").on(t.sourceEventId, t.userId, t.type),
  }),
);
