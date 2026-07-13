import { type Migration, tenantRlsSql } from "@casper/platform";

/**
 * casper-changesets DDL. All three tables are workspace tenant data and get org RLS
 * (`tenantRlsSql`), so a change set is never visible cross-tenant even if app code
 * has a bug. The app role's DML comes from the platform bootstrap's default
 * privileges — no per-table grants needed.
 */
export const changesetsMigrations: Migration[] = [
  {
    module: "changesets",
    version: 1,
    name: "changeset_engine",
    sql: `
      CREATE TABLE changesets (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        author_kind text NOT NULL,
        author_id uuid NOT NULL,
        origin text NOT NULL,
        title text NOT NULL,
        intent text,
        status text NOT NULL DEFAULT 'draft',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX changesets_ws_idx ON changesets (workspace_id, status);

      CREATE TABLE changes (
        id uuid PRIMARY KEY,
        changeset_id uuid NOT NULL,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        position integer NOT NULL DEFAULT 0,
        op text NOT NULL,
        target jsonb NOT NULL,
        payload jsonb,
        base_version text,
        risk text NOT NULL,
        approval text NOT NULL DEFAULT 'pending',
        validation jsonb NOT NULL,
        applied_at timestamptz,
        inverse_op jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX changes_changeset_idx ON changes (changeset_id, position);

      CREATE TABLE changeset_reviews (
        id uuid PRIMARY KEY,
        changeset_id uuid NOT NULL,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        change_id uuid,
        reviewer_kind text NOT NULL,
        reviewer_id uuid NOT NULL,
        decision text NOT NULL,
        note text,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX changeset_reviews_cs_idx ON changeset_reviews (changeset_id);

      ${tenantRlsSql("changesets")}
      ${tenantRlsSql("changes")}
      ${tenantRlsSql("changeset_reviews")}
    `,
  },
];
