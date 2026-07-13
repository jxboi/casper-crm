import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  index,
  unique,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * casper-workflow storage. `workflow_definitions` is an org-global config snapshot
 * (like records' `record_types`) — versioned, no tenant RLS; `status` marks which
 * version is `active`. `automation_definitions` is likewise org-global config; the
 * `automation_runs` **run log** is workspace-scoped tenant data (RLS). The migration
 * DDL in `migrations.ts` is the source of truth; these declarations mirror it for
 * typed queries.
 */
export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    recordType: text("record_type").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull().default("active"),
    definition: jsonb("definition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.recordType, t.version] }) }),
);

export const automationDefinitions = pgTable(
  "automation_definitions",
  {
    id: text("id").notNull(),
    version: integer("version").notNull(),
    recordType: text("record_type"),
    enabled: boolean("enabled").notNull().default(true),
    definition: jsonb("definition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.id, t.version] }) }),
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    automationId: text("automation_id").notNull(),
    triggerEventId: uuid("trigger_event_id").notNull(),
    recordType: text("record_type"),
    recordId: text("record_id"),
    status: text("status").notNull(),
    depth: integer("depth").notNull().default(0),
    conditionResult: boolean("condition_result"),
    effects: jsonb("effects"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: unique("automation_runs_idem").on(t.automationId, t.triggerEventId),
    pendingIdx: index("automation_runs_status_idx").on(t.workspaceId, t.status),
  }),
);
