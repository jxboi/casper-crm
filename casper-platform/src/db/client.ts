import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { AppError } from "../errors.js";

/**
 * Database access (D-002). Business modules never import `pg`/`drizzle` clients
 * directly — always through this platform handle. Dev and test run against
 * in-process PGlite (real Postgres in WASM, so RLS actually enforces); prod would
 * bind the Neon serverless driver here behind config (D-019) without any module
 * changes, since the query surface is dialect-agnostic drizzle-pg.
 */
export type Db = PgliteDatabase<Record<string, never>> & { $client: PGlite };

/** A drizzle transaction — the executor the tenant-scoped write/read paths use. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything that can run queries: the root handle or a transaction. */
export type Executor = Db | Tx;

let instance: Db | undefined;

export function createPgliteDb(dataDir?: string): Db {
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  return drizzle(client) as Db;
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
