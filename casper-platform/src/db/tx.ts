import { sql } from "drizzle-orm";
import { getDb, type Tx } from "./client.js";
import { requestContext } from "../context.js";
import { isSystem } from "../principal.js";
import { APP_ROLE } from "./bootstrap-migration.js";

/**
 * The single tenant-scoped data-access path (D-005). A `withTx` transaction:
 *   1. sets the RLS session variables (`app.org_id`, `app.principal_id`,
 *      `app.bypass_rls`) from the current request context via `set_config(...,
 *      true)` so they are transaction-local — correct under Neon connection
 *      pooling where connections are shared;
 *   2. runs the caller's work and the event outbox insert in the same tx, so
 *      events commit atomically with the mutation.
 *
 * All tenant-scoped reads and writes go through here; `getDb()` raw access is
 * reserved for migrations and system bootstrap.
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const ctx = requestContext.require();
  const bypass = isSystem(ctx.principal);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.org_id', ${ctx.orgId}, true)`);
    await tx.execute(sql`SELECT set_config('app.principal_id', ${ctx.principal.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.bypass_rls', ${bypass ? "on" : "off"}, true)`);
    // Non-system principals run as the limited app role so RLS actually applies
    // (superusers bypass it). System principals stay superuser + bypass flag.
    if (!bypass) {
      await tx.execute(sql.raw(`SET LOCAL ROLE ${APP_ROLE}`));
    }
    return fn(tx);
  });
}

/**
 * Run `fn` with RLS bypassed regardless of the active principal — for trusted
 * cross-tenant maintenance (migrations, seeds, sweeper). Still transactional.
 */
export async function withSystemTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}
