import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Tenancy + identity tables (auth plan "data model sketch"; D-003, D-020, D-021).
 * Drizzle definitions back typed queries in the service and `can()` engine; the
 * DDL that creates them (with RLS) lives in `migrations.ts`.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  // D-021 configurable manager model; only 'workspace' is implemented pre-P2.
  managerModel: text("manager_model").notNull().default("workspace"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    orgId: uuid("org_id").notNull(),
    teamId: uuid("team_id").notNull(),
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.teamId, t.userId] }) }),
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    // Built-in role key (roles.ts). Custom roles deferred to P3+.
    role: text("role").notNull(),
    // D-024 member lifecycle.
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uqWorkspaceUser: unique().on(t.workspaceId, t.userId) }),
);

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
