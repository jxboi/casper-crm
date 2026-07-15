import {
  registerMigrations,
  createPgliteDb,
  setDb,
  runMigrations,
  requestContext,
  type Db,
  type Principal,
} from "@casper/platform";
import {
  authMigrations,
  createOrg,
  createWorkspace,
  createUser,
  addMembership,
} from "@casper/auth";
import { eventsMigrations } from "@casper/events";
import { registerRecordsModule } from "@casper/records";
import { registerWorkflowModule } from "@casper/workflow";
import { registerChangesetsModule } from "@casper/changesets";
import { registerAiModule } from "@casper/ai";
import { registerSalesModule, seedSalesData } from "@casper/sales";

/**
 * Server-only engine bootstrap for the dev/dogfood web app.
 *
 * The whole modular monolith runs **in-process** inside the Next server: we register
 * every module's migrations + config, spin up a PGlite database (D-019 — real Postgres
 * in WASM, the Neon swap is prod-only), run migrations, and seed a dev org/workspace +
 * the sales demo dataset. Because PGlite is in-memory, each server process starts from a
 * clean, fully-seeded state — ideal for a dogfood/demo slice.
 *
 * Identity: OAuth login is deferred (a P0 item), so the app runs as a single **dev
 * principal** (a Manager, so re-open transitions are allowed). Everything the UI does is
 * still routed through `can()` + the single write path under that principal.
 *
 * ## Why this is split into "register every graph" + "provision once"
 *
 * Next/webpack bundles Route Handlers, Server Actions, and RSC into **separate module
 * graphs**, so the engine's module-level singletons — the record/workflow registries and
 * the `setDb` handle — are duplicated per graph. The actual PGlite database and the seed
 * must happen exactly once (guarded on `globalThis`), but each graph's in-memory
 * registries must be (re-)populated and pointed at that one shared database. So:
 *   - `registerAll()` (idempotent, in-memory) runs on every `getEngine()` call;
 *   - `provision()` (create DB + migrate + seed) runs once, cached on `globalThis`.
 */
export interface EngineHandle {
  principal: Principal;
  orgId: string;
  workspaceId: string;
  userName: string;
}

interface Provisioned extends EngineHandle {
  db: Db;
}

/** Populate this module graph's registries. Idempotent — safe to call per request. */
function registerAll(): void {
  registerMigrations(authMigrations);
  registerMigrations(eventsMigrations);
  registerRecordsModule();
  registerWorkflowModule();
  registerChangesetsModule();
  registerAiModule();
  registerSalesModule();
}

/** Create the database, migrate, and seed — exactly once for the process. */
async function provision(): Promise<Provisioned> {
  registerAll();

  const db = createPgliteDb();
  setDb(db);
  await runMigrations(db);

  const org = await createOrg("Casper (dev)");
  const ws = await createWorkspace(org.id, "Sales");
  const user = await createUser("founder@casper.dev", "Amara Devi");
  await addMembership({ orgId: org.id, workspaceId: ws.id, userId: user.id, role: "manager" });

  const principal: Principal = { kind: "user", id: user.id, orgId: org.id, workspaceId: ws.id };
  await requestContext.run({ principal }, () => seedSalesData({ variant: "demo" }));

  return { db, principal, orgId: org.id, workspaceId: ws.id, userName: "Amara Devi" };
}

const globalForEngine = globalThis as unknown as {
  __casperProvision?: Promise<Provisioned>;
};

/**
 * Boot the engine (once per process) and ensure the calling module graph's registries
 * are wired to the one shared database. Returns the dev tenant handle.
 */
export async function getEngine(): Promise<EngineHandle> {
  globalForEngine.__casperProvision ??= provision();
  const p = await globalForEngine.__casperProvision;
  // This graph may be a different webpack bundle than the one that provisioned: make
  // sure its in-memory registries are populated and its db handle points at the shared
  // PGlite instance. Both operations are idempotent.
  registerAll();
  setDb(p.db);
  return { principal: p.principal, orgId: p.orgId, workspaceId: p.workspaceId, userName: p.userName };
}
