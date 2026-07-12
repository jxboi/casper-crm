/**
 * Built-in roles and their grant bundles (auth plan; D-020, D-023). Custom roles
 * are deferred to P3+, so for P0 the built-ins are code-defined constants rather
 * than rows — this keeps `can()` a pure function over a small in-memory table and
 * well under the <1ms target. Guest is intentionally absent (cut in D-020).
 *
 * A grant pairs an action pattern with the widest scope at which the role may
 * perform it. Scope ordering (own < team < workspace < org) reflects D-020's
 * "open read, role-scoped write": reads are granted workspace-wide to everyone;
 * writes widen with seniority.
 */
export type Scope = "own" | "team" | "workspace" | "org";

export const SCOPE_RANK: Record<Scope, number> = {
  own: 0,
  team: 1,
  workspace: 2,
  org: 3,
};

export interface Grant {
  action: string;
  scope: Scope;
}

export type BuiltinRole =
  | "org_owner"
  | "org_admin"
  | "workspace_admin"
  | "manager"
  | "member";

export const BUILTIN_ROLES: readonly BuiltinRole[] = [
  "org_owner",
  "org_admin",
  "workspace_admin",
  "manager",
  "member",
];

// Everyone reads workspace-wide (D-020 open read) and manages their own records.
const MEMBER_GRANTS: Grant[] = [
  { action: "record.read", scope: "workspace" },
  { action: "record.create", scope: "workspace" },
  { action: "record.update", scope: "own" },
  { action: "record.archive", scope: "own" },
  { action: "record.transition", scope: "own" },
  { action: "record.field.write:*", scope: "own" },
];

// Managers edit across their team(s) and can approve change sets.
const MANAGER_GRANTS: Grant[] = [
  ...MEMBER_GRANTS,
  { action: "record.update", scope: "team" },
  { action: "record.archive", scope: "team" },
  { action: "record.transition", scope: "team" },
  { action: "record.field.write:*", scope: "team" },
  { action: "changeset.approve", scope: "workspace" },
];

const WORKSPACE_ADMIN_GRANTS: Grant[] = [
  { action: "record.*", scope: "workspace" },
  { action: "changeset.approve", scope: "workspace" },
  { action: "workflow.publish", scope: "workspace" },
  { action: "member.*", scope: "workspace" },
  { action: "team.manage", scope: "workspace" },
];

const ORG_ADMIN_GRANTS: Grant[] = [
  { action: "record.*", scope: "org" },
  { action: "changeset.approve", scope: "org" },
  { action: "workflow.publish", scope: "org" },
  { action: "member.*", scope: "org" },
  { action: "workspace.create", scope: "org" },
  { action: "team.manage", scope: "org" },
];

const ORG_OWNER_GRANTS: Grant[] = [{ action: "*", scope: "org" }];

export const ROLE_GRANTS: Record<BuiltinRole, Grant[]> = {
  member: MEMBER_GRANTS,
  manager: MANAGER_GRANTS,
  workspace_admin: WORKSPACE_ADMIN_GRANTS,
  org_admin: ORG_ADMIN_GRANTS,
  org_owner: ORG_OWNER_GRANTS,
};

export function isBuiltinRole(x: string): x is BuiltinRole {
  return (BUILTIN_ROLES as readonly string[]).includes(x);
}
