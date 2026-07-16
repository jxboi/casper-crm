import { sql } from "drizzle-orm";
import {
  createDb,
  getDb,
  hasDb,
  registerMigrations,
  runMigrations,
  setDb,
  type Db,
} from "@casper/platform";
import { authMigrations } from "@casper/auth";
import { dispatchPending, eventsMigrations } from "@casper/events";
import { registerRecordsModule } from "@casper/records";
import { registerWorkflowModule } from "@casper/workflow";
import { registerChangesetsModule } from "@casper/changesets";
import { registerAiModule } from "@casper/ai";
import { registerSalesModule } from "@casper/sales";

interface RuntimeState {
  db: Db;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __casperRuntimeState?: Promise<RuntimeState>;
};

export function registerRuntimeModules(): void {
  registerMigrations(authMigrations);
  registerMigrations(eventsMigrations);
  registerRecordsModule();
  registerWorkflowModule();
  registerChangesetsModule();
  registerAiModule();
  registerSalesModule();
}

async function provision(): Promise<RuntimeState> {
  registerRuntimeModules();
  // Test/dev bootstraps may deliberately bind a database before the composition
  // root starts. Reuse that handle so jobs and request handlers share one runtime.
  const db = hasDb() ? getDb() : createDb();
  setDb(db);
  await runMigrations(db);
  return { db };
}

/** Shared composition root for route handlers, cron jobs, and workflow steps. */
export async function initializeRuntime(): Promise<Db> {
  runtimeGlobal.__casperRuntimeState ??= provision();
  const state = await runtimeGlobal.__casperRuntimeState;
  registerRuntimeModules();
  setDb(state.db);
  return state.db;
}

/** Drain the transactional outbox. Safe to retry because all consumers are idempotent. */
export async function sweepOutbox(limit = 500): Promise<number> {
  await initializeRuntime();
  return dispatchPending(limit);
}

export async function runtimeHealth(): Promise<{
  ok: true;
  database: "ready";
  checkedAt: string;
}> {
  await initializeRuntime();
  await getDb().execute(sql`SELECT 1`);
  return { ok: true, database: "ready", checkedAt: new Date().toISOString() };
}
