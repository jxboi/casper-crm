import type { Migration } from "./migrate.js";

/**
 * Platform bootstrap migration. Creates the non-superuser application role that
 * tenant-scoped transactions assume (`withTx` → `SET LOCAL ROLE casper_app`).
 *
 * This is what makes RLS real: Postgres superusers (and, under PGlite, the default
 * `postgres` role) bypass RLS unconditionally even with FORCE enabled. Running
 * business queries as a non-superuser is both the production posture (the app
 * connects to Neon as a limited role) and what lets the cross-tenant isolation
 * test actually fail. Default privileges grant the role DML on every table created
 * afterwards, so domain migrations need no per-table grant boilerplate.
 */
export const platformMigrations: Migration[] = [
  {
    module: "platform",
    version: 1,
    name: "app_role",
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'casper_app') THEN
          CREATE ROLE casper_app NOLOGIN;
        END IF;
      END
      $$;
      GRANT USAGE ON SCHEMA public TO casper_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO casper_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO casper_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO casper_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO casper_app;
    `,
  },
];

/** The role name tenant-scoped transactions assume. */
export const APP_ROLE = "casper_app";
