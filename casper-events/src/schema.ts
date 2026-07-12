import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

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
    subjectId: uuid("subject_id").notNull(),
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
    subjectId: uuid("subject_id").notNull(),
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
    recordId: uuid("record_id").notNull(),
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
  subjectId: uuid("subject_id"),
  data: jsonb("data").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
});
