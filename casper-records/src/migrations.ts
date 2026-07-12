import { type Migration, tenantRlsSql } from "@casper/platform";

/**
 * casper-records DDL. `records`, `relations`, and `saved_views` are workspace data
 * and get tenant RLS; `record_types` / `field_defs` are org-global config snapshots
 * (no RLS). The `search` tsvector is a STORED generated column over `data`, so FTS
 * needs no write-path maintenance, and `data` gets a GIN index for JSONB filters.
 */
export const recordsMigrations: Migration[] = [
  {
    module: "records",
    version: 1,
    name: "record_engine",
    sql: `
      CREATE TABLE records (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        type text NOT NULL,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        owner_id uuid NOT NULL,
        version integer NOT NULL DEFAULT 1,
        last_activity_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz,
        search tsvector GENERATED ALWAYS AS (to_tsvector('english', data::text)) STORED
      );
      CREATE INDEX records_type_idx ON records (workspace_id, type);
      CREATE INDEX records_owner_idx ON records (owner_id);
      CREATE INDEX records_activity_idx ON records (type, last_activity_at);
      CREATE INDEX records_data_gin ON records USING gin (data);
      CREATE INDEX records_search_gin ON records USING gin (search);

      CREATE TABLE relations (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        from_type text NOT NULL,
        from_id uuid NOT NULL,
        field_key text NOT NULL,
        to_type text NOT NULL,
        to_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (from_id, field_key, to_id)
      );
      CREATE INDEX relations_from_idx ON relations (from_type, from_id);
      CREATE INDEX relations_to_idx ON relations (to_type, to_id);

      CREATE TABLE saved_views (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        record_type text NOT NULL,
        name text NOT NULL,
        scope text NOT NULL DEFAULT 'personal',
        owner_id uuid,
        filter jsonb,
        sort jsonb,
        columns jsonb,
        layout jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX saved_views_type_idx ON saved_views (workspace_id, record_type);

      CREATE TABLE record_types (
        key text NOT NULL,
        version integer NOT NULL,
        name_singular text NOT NULL,
        name_plural text NOT NULL,
        icon text,
        color text,
        origin text NOT NULL,
        primary_field text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (key, version)
      );

      CREATE TABLE field_defs (
        type_key text NOT NULL,
        version integer NOT NULL,
        key text NOT NULL,
        label text NOT NULL,
        field_type text NOT NULL,
        required boolean NOT NULL DEFAULT false,
        is_unique boolean NOT NULL DEFAULT false,
        sensitivity boolean NOT NULL DEFAULT false,
        position integer NOT NULL DEFAULT 0,
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY (type_key, version, key)
      );

      ${tenantRlsSql("records")}
      ${tenantRlsSql("relations")}
      ${tenantRlsSql("saved_views")}

      GRANT SELECT ON record_types TO casper_app;
      GRANT SELECT ON field_defs TO casper_app;
    `,
  },
];
