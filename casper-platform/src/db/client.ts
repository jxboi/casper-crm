import { PGlite } from "@electric-sql/pglite";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { AppError } from "../errors.js";
import { config } from "../config.js";

/**
 * Database access (D-002/D-019). Business modules never import `pg`/`drizzle`
 * clients directly — always through this platform handle. Dev and test run against
 * in-process PGlite (real Postgres in WASM, so RLS actually enforces); when
 * `DATABASE_URL` is set the same handle binds the Neon serverless driver instead —
 * the **WebSocket** driver (`Pool`), never neon-http, because `withTx`'s RLS
 * pattern (SET LOCAL ROLE + transaction-local set_config) needs interactive
 * transactions on one connection. No module changes either way: the query surface
 * is dialect-agnostic drizzle-pg.
 *
 * `Db` is typed off the PGlite driver and the Neon handle is cast into it: the two
 * drivers share the drizzle-pg query/transaction surface and both return `{ rows }`
 * from `execute()`, so the shape is honest at runtime; the one place the underlying
 * clients genuinely differ (multi-statement migration scripts) branches on
 * `$client` explicitly (see migrate.ts).
 */
export type DbClient = PGlite | Pool;
export type Db = PgliteDatabase<Record<string, never>> & { $client: DbClient };

/** A drizzle transaction — the executor the tenant-scoped write/read paths use. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything that can run queries: the root handle or a transaction. */
export type Executor = Db | Tx;

let instance: Db | undefined;

export function createPgliteDb(dataDir?: string): Db {
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  return drizzlePglite(client) as Db;
}

/** Bind Neon over the WebSocket driver (interactive transactions — see above). */
export function createNeonDb(connectionString: string): Db {
  if (!neonConfig.webSocketConstructor) {
    const ws = (globalThis as { WebSocket?: unknown }).WebSocket;
    if (!ws) {
      throw new AppError(
        "invalid_state",
        "Neon needs a WebSocket implementation: run on Node >= 22 (global WebSocket) or set neonConfig.webSocketConstructor",
      );
    }
    neonConfig.webSocketConstructor = ws;
  }
  const pool = new Pool({ connectionString });
  return drizzleNeon(pool) as unknown as Db;
}

/**
 * The config-driven factory (D-019): `DATABASE_URL` set → Neon; otherwise PGlite
 * (on-disk if `PGLITE_DATA` is set, else in-memory). App bootstrap calls this;
 * tests keep calling `createPgliteDb` via the testkit so a stray `DATABASE_URL`
 * can never point the suite at a real database.
 */
export function createDb(): Db {
  const cfg = config();
  return cfg.DATABASE_URL ? createNeonDb(cfg.DATABASE_URL) : createPgliteDb(cfg.PGLITE_DATA);
}

/** Bind the process-wide DB handle. Called once by app/test bootstrap. */
export function setDb(db: Db): void {
  instance = db;
}

export function getDb(): Db {
  if (!instance) {
    throw new AppError(
      "invalid_state",
      "Database not initialized: call setDb() during bootstrap (or use the platform testkit)",
    );
  }
  return instance;
}

export function hasDb(): boolean {
  return instance !== undefined;
}

/** Test/reset hook. */
export function resetDb(): void {
  instance = undefined;
}
