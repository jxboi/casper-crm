import { sql } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "./client.js";
import { logger } from "../logger.js";
import { platformMigrations } from "./bootstrap-migration.js";

/**
 * Per-module migrations, applied by a central runner (platform plan). Each module
 * exports an ordered list; the runner records what it has applied in `_migrations`
 * and is idempotent, so calling it repeatedly (e.g. per test suite) is safe.
 *
 * DDL is not row-filtered by RLS, so migrations need no tenant session vars.
 */
export interface Migration {
  /** Owning module, e.g. "records". */
  module: string;
  /** Monotonic within a module. */
  version: number;
  name: string;
  /** One or more SQL statements. */
  sql: string;
}

const registry: Migration[] = [];

export function registerMigrations(migrations: Migration[]): void {
  registry.push(...migrations);
}

/** Test hook: forget registered migrations. */
export function resetMigrations(): void {
  registry.length = 0;
}

export async function runMigrations(db: Db): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      module text NOT NULL,
      version integer NOT NULL,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (module, version)
    );
  `);

  const applied = await db.execute<{ module: string; version: number }>(
    sql`SELECT module, version FROM _migrations`,
  );
  const done = new Set(applied.rows.map((r) => `${r.module}:${r.version}`));

  // The platform bootstrap (app role + default privileges) always applies first,
  // ahead of any registered domain migration, so the app role exists and its
  // default privileges cover every table those migrations create.
  const pending = [
    ...platformMigrations,
    ...[...registry].sort((a, b) => a.module.localeCompare(b.module) || a.version - b.version),
  ];

  for (const m of pending) {
    const key = `${m.module}:${m.version}`;
    if (done.has(key)) continue;
    // Multi-statement DDL can't ride the prepared-statement path on either driver,
    // so scripts run through each client's simple-query facility — PGlite's `exec()`
    // batch API, or an unparameterized `query()` on the Neon pool (node-postgres
    // uses the multi-statement simple protocol when no params are bound) — wrapped
    // in an explicit transaction for atomicity.
    const script = `BEGIN;\n${m.sql}\nCOMMIT;`;
    if (db.$client instanceof PGlite) {
      await db.$client.exec(script);
    } else {
      await db.$client.query(script);
    }
    await db.execute(
      sql`INSERT INTO _migrations (module, version, name) VALUES (${m.module}, ${m.version}, ${m.name})`,
    );
    logger.info("migration.applied", { module: m.module, version: m.version, name: m.name });
  }
}
