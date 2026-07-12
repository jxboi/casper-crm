import { type Migration, tenantRlsSql } from "@casper/platform";

/**
 * casper-auth DDL. Workspace-scoped tables carry `org_id` and get the standard
 * tenant RLS policy (defense-in-depth, D-002). `organizations` is keyed by the
 * org id itself, so its policy compares `id`; `users` is global (a person may
 * belong to multiple orgs) and is guarded at the application layer only.
 */
export const authMigrations: Migration[] = [
  {
    module: "auth",
    version: 1,
    name: "tenancy",
    sql: `
      CREATE TABLE organizations (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        manager_model text NOT NULL DEFAULT 'workspace',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE users (
        id uuid PRIMARY KEY,
        email text NOT NULL UNIQUE,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE workspaces (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL REFERENCES organizations(id),
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX workspaces_org_idx ON workspaces (org_id);

      CREATE TABLE teams (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL REFERENCES workspaces(id),
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX teams_workspace_idx ON teams (workspace_id);

      CREATE TABLE team_members (
        org_id uuid NOT NULL,
        team_id uuid NOT NULL REFERENCES teams(id),
        user_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (team_id, user_id)
      );
      CREATE INDEX team_members_user_idx ON team_members (user_id);

      CREATE TABLE memberships (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL REFERENCES workspaces(id),
        user_id uuid NOT NULL REFERENCES users(id),
        role text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, user_id)
      );
      CREATE INDEX memberships_user_idx ON memberships (user_id);

      CREATE TABLE invitations (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        email text NOT NULL,
        role text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      ${tenantRlsSql("workspaces")}
      ${tenantRlsSql("teams")}
      ${tenantRlsSql("team_members")}
      ${tenantRlsSql("memberships")}
      ${tenantRlsSql("invitations")}

      ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS organizations_tenant_isolation ON organizations;
      CREATE POLICY organizations_tenant_isolation ON organizations
        USING (
          current_setting('app.bypass_rls', true) = 'on'
          OR id::text = current_setting('app.org_id', true)
        )
        WITH CHECK (
          current_setting('app.bypass_rls', true) = 'on'
          OR id::text = current_setting('app.org_id', true)
        );
    `,
  },
];
