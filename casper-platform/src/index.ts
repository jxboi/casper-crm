// casper-platform — shared kernel. Business modules import infrastructure only
// through this surface (D-001), never `pg`/`drizzle`/queue libs directly.

export { AppError, isAppError, type AppErrorCode } from "./errors.js";
export { newId, isUuid } from "./ids.js";
export {
  type Principal,
  type PrincipalKind,
  systemPrincipal,
  isSystem,
  SYSTEM_PRINCIPAL_ID,
} from "./principal.js";
export { now, setClock, systemClock, FakeClock, type Clock } from "./clock.js";
export { requestContext, type RequestContext, type RunContextInput } from "./context.js";
export { logger } from "./logger.js";
export { config, loadConfig, type Config } from "./config.js";

export {
  type Db,
  type DbClient,
  type Tx,
  type Executor,
  getDb,
  setDb,
  hasDb,
  resetDb,
  createPgliteDb,
  createNeonDb,
  createDb,
} from "./db/client.js";
export { withTx, withSystemTx } from "./db/tx.js";
export {
  type Migration,
  registerMigrations,
  resetMigrations,
  runMigrations,
} from "./db/migrate.js";
export { tenantRlsSql } from "./db/rls.js";
export { platformMigrations, APP_ROLE } from "./db/bootstrap-migration.js";
