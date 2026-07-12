import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  index,
  unique,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * Records storage (D-013). Typed field values live in the `data` JSONB column
 * (GIN-indexed); hot fields get promoted to generated columns when profiling
 * justifies it. `version` is the optimistic-concurrency token change sets check;
 * `last_activity_at` (maintained by an events consumer) powers "neglected" filters.
 * A generated `search` tsvector column (declared in the migration, not here) backs
 * FTS; queries select explicit columns so they never touch it directly.
 */
export const records = pgTable(
  "records",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    type: text("type").notNull(),
    data: jsonb("data").notNull().default({}),
    ownerId: uuid("owner_id").notNull(),
    version: integer("version").notNull().default(1),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    typeIdx: index("records_type_idx").on(t.workspaceId, t.type),
    ownerIdx: index("records_owner_idx").on(t.ownerId),
  }),
);

export const relations = pgTable(
  "relations",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    fromType: text("from_type").notNull(),
    fromId: uuid("from_id").notNull(),
    fieldKey: text("field_key").notNull(),
    toType: text("to_type").notNull(),
    toId: uuid("to_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: unique().on(t.fromId, t.fieldKey, t.toId),
    fromIdx: index("relations_from_idx").on(t.fromType, t.fromId),
    toIdx: index("relations_to_idx").on(t.toType, t.toId),
  }),
);

export const savedViews = pgTable("saved_views", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  recordType: text("record_type").notNull(),
  name: text("name").notNull(),
  // 'personal' views belong to owner_id; 'shared' views have owner_id null.
  scope: text("scope").notNull().default("personal"),
  ownerId: uuid("owner_id"),
  filter: jsonb("filter"),
  sort: jsonb("sort"),
  columns: jsonb("columns"),
  layout: jsonb("layout"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- Org-global config snapshots (D-013): type/field definitions are global;
// only record *data* is workspace-scoped. No org_id / RLS here.

export const recordTypes = pgTable(
  "record_types",
  {
    key: text("key").notNull(),
    version: integer("version").notNull(),
    nameSingular: text("name_singular").notNull(),
    namePlural: text("name_plural").notNull(),
    icon: text("icon"),
    color: text("color"),
    origin: text("origin").notNull(),
    primaryField: text("primary_field").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.key, t.version] }) }),
);

export const fieldDefs = pgTable(
  "field_defs",
  {
    typeKey: text("type_key").notNull(),
    version: integer("version").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    required: boolean("required").notNull().default(false),
    unique: boolean("is_unique").notNull().default(false),
    sensitivity: boolean("sensitivity").notNull().default(false),
    position: integer("position").notNull().default(0),
    config: jsonb("config").notNull().default({}),
  },
  (t) => ({ pk: primaryKey({ columns: [t.typeKey, t.version, t.key] }) }),
);
