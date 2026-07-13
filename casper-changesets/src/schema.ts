import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Change-set storage. All three tables are workspace tenant data (org-scoped RLS,
 * declared in migrations.ts). `changes.target`/`payload`/`validation`/`inverse_op`
 * are JSONB — the ops-as-data model. `applied_at` per change makes commit resumable
 * (a crash reports partial application, never silently). `inverse_op` is captured on
 * apply to seed P2 compensating-set rollback.
 */
export const changesets = pgTable("changesets", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  authorKind: text("author_kind").notNull(),
  authorId: uuid("author_id").notNull(),
  origin: text("origin").notNull(),
  title: text("title").notNull(),
  intent: text("intent"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const changes = pgTable(
  "changes",
  {
    id: uuid("id").primaryKey(),
    changesetId: uuid("changeset_id").notNull(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    position: integer("position").notNull().default(0),
    op: text("op").notNull(),
    target: jsonb("target").notNull(),
    payload: jsonb("payload"),
    baseVersion: text("base_version"),
    risk: text("risk").notNull(),
    approval: text("approval").notNull().default("pending"),
    validation: jsonb("validation").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    inverseOp: jsonb("inverse_op"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ csIdx: index("changes_changeset_idx").on(t.changesetId, t.position) }),
);

export const changesetReviews = pgTable("changeset_reviews", {
  id: uuid("id").primaryKey(),
  changesetId: uuid("changeset_id").notNull(),
  orgId: uuid("org_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  changeId: uuid("change_id"),
  reviewerKind: text("reviewer_kind").notNull(),
  reviewerId: uuid("reviewer_id").notNull(),
  decision: text("decision").notNull(),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
