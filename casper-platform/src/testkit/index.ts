import { createPgliteDb, setDb, resetDb } from "../db/client.js";
import { runMigrations, resetMigrations } from "../db/migrate.js";
import { setClock, systemClock, FakeClock } from "../clock.js";

/**
 * Platform test kit (platform plan). Spins up a fresh in-process PGlite database,
 * applies all registered migrations, and returns teardown. Suites import each
 * module's migrations (registering them) before calling `setupTestDb()`.
 */
export interface TestDb {
  teardown(): void;
}

export async function setupTestDb(): Promise<TestDb> {
  const db = createPgliteDb();
  setDb(db);
  await runMigrations(db);
  return {
    teardown() {
      resetDb();
    },
  };
}

/**
 * Full reset for isolated suites: clears the DB handle, the migration registry,
 * and the clock. Call in a global `afterEach`/`afterAll` when a suite mutates
 * global registration state.
 */
export function resetPlatform(): void {
  resetDb();
  resetMigrations();
  setClock(systemClock);
}

export { FakeClock, setClock };
