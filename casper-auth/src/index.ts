// casper-auth — identity, tenancy, and the single authorization gate `can()`.
// AuthN (better-auth GitHub OAuth + email/password) is deferred within this
// module: records and the rest of the engine depend on principals + `can()`, not
// on the login flow, so P0 ships the authorization core and tenancy first.

export type { Principal, PrincipalKind } from "@casper/platform";
export { systemPrincipal, SYSTEM_PRINCIPAL_ID } from "@casper/platform";

export {
  can,
  assertCan,
  type Decision,
  type ResourceRef,
  type CanContext,
} from "./can.js";

export {
  type Action,
  type RecordAction,
  type AdminAction,
  type EngineAction,
  type FieldWriteAction,
  isFieldWrite,
  fieldWriteKey,
  actionMatches,
} from "./actions.js";

export {
  type BuiltinRole,
  type Scope,
  type Grant,
  ROLE_GRANTS,
  BUILTIN_ROLES,
  SCOPE_RANK,
  isBuiltinRole,
} from "./roles.js";

export {
  createOrg,
  createUser,
  createWorkspace,
  createTeam,
  addToTeam,
  addMembership,
  type Org,
} from "./service.js";

export { authMigrations } from "./migrations.js";
export * as schema from "./schema.js";
