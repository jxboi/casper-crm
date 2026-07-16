// casper-auth — identity, tenancy, and the single authorization gate `can()`.
// Authentication is hosted by casper-web through Better Auth; this module owns
// the shared identity rows, tenant provisioning, principal resolution, and can().

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
  type CollaborationAction,
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
  createWorkspace,
  createTeam,
  addToTeam,
  provisionInitialTenant,
  resolvePrincipal,
  inviteMember,
  acceptInvitation,
  changeMemberRole,
  type Org,
  type ResolvedPrincipal,
  type InvitationModel,
} from "./service.js";

export { authMigrations } from "./migrations.js";
export * as schema from "./schema.js";
