import { and, eq, inArray } from "drizzle-orm";
import { AppError, withSystemTx, type Principal } from "@casper/platform";
import { memberships, teamMembers, teams } from "./schema.js";
import { actionMatches } from "./actions.js";
import { ROLE_GRANTS, SCOPE_RANK, isBuiltinRole, type Grant } from "./roles.js";

/**
 * The single authorization gate (master-plan §6, D-004). Every module write path
 * and every AI tool calls it. Returns allow/deny + a reason (the reason feeds the
 * `auth.permission_denied` event and the permission-denial-correctness metric).
 *
 * Access model v1 (D-020): reads are open workspace-wide; writes resolve through
 * grant scopes — `own` (actor is the owner), `team` (actor shares ≥1 team with the
 * owner), `workspace`, `org`. Teams carry no id on records: membership derives the
 * mapping and team grants union across an actor's teams.
 */

export type ResourceRef =
  | { kind: "record"; type: string; id?: string; ownerId?: string; workspaceId?: string }
  | { kind: "workspace"; id: string }
  | { kind: "changeset"; id?: string; authorId?: string; workspaceId?: string }
  | { kind: "member"; userId?: string; workspaceId?: string }
  | { kind: "org" }
  | { kind: "global" };

export interface CanContext {
  /** Overrides the workspace the decision is evaluated in. */
  workspaceId?: string;
}

export interface Decision {
  allow: boolean;
  reason: string;
}

function allow(reason: string): Decision {
  return { allow: true, reason };
}
function deny(reason: string): Decision {
  return { allow: false, reason };
}

function resourceWorkspaceId(resource: ResourceRef): string | undefined {
  return "workspaceId" in resource ? resource.workspaceId : undefined;
}

function resourceOwnerId(resource: ResourceRef): string | undefined {
  if (resource.kind === "record") return resource.ownerId;
  if (resource.kind === "changeset") return resource.authorId;
  if (resource.kind === "member") return resource.userId;
  return undefined;
}

export async function can(
  principal: Principal,
  action: string,
  resource: ResourceRef,
  ctx: CanContext = {},
): Promise<Decision> {
  // System principals (migrations, jobs, seeds) are fully trusted.
  if (principal.kind === "system") return allow("system principal");

  // Assistant capping (D-022) is implemented when assistant principals land (P1):
  // effective = registry scope ∩ owner's permissions. Until then, deny by default
  // so nothing slips through unguarded.
  if (principal.kind === "assistant" || principal.kind === "api_key") {
    return deny(`principal kind '${principal.kind}' not yet supported (P1)`);
  }

  const workspaceId =
    ctx.workspaceId ?? resourceWorkspaceId(resource) ?? principal.workspaceId;
  if (!workspaceId) {
    return deny("no workspace in scope for decision");
  }

  return withSystemTx(async (tx) => {
    const memb = await tx
      .select({ role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, principal.id),
          eq(memberships.workspaceId, workspaceId),
          eq(memberships.orgId, principal.orgId),
        ),
      )
      .limit(1);

    const row = memb[0];
    if (!row) return deny("actor is not a member of the workspace");
    if (row.status !== "active") return deny("membership is deactivated");
    if (!isBuiltinRole(row.role)) return deny(`unknown role '${row.role}'`);

    const grants = ROLE_GRANTS[row.role];
    const matching = grants.filter((g) => actionMatches(g.action, action));
    if (matching.length === 0) {
      return deny(`role '${row.role}' has no grant for '${action}'`);
    }

    const ownerId = resourceOwnerId(resource);

    // Evaluate widest-satisfiable grant first so the reason names the scope used.
    const ordered = [...matching].sort((a, b) => SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope]);
    for (const grant of ordered) {
      const ok = await scopeSatisfied(tx, grant, principal, workspaceId, ownerId);
      if (ok) {
        return allow(`role '${row.role}' grants '${action}' at scope '${grant.scope}'`);
      }
    }

    return deny(
      `role '${row.role}' can '${action}' only within a narrower scope than this resource`,
    );
  });
}

async function scopeSatisfied(
  tx: Parameters<Parameters<typeof withSystemTx>[0]>[0],
  grant: Grant,
  principal: Principal,
  workspaceId: string,
  ownerId: string | undefined,
): Promise<boolean> {
  switch (grant.scope) {
    case "org":
      // Same org guaranteed by tenancy; cross-org is blocked by RLS upstream.
      return true;
    case "workspace":
      return true; // membership was already resolved in this workspace
    case "own":
      return ownerId !== undefined && ownerId === principal.id;
    case "team": {
      if (ownerId === undefined) return false;
      if (ownerId === principal.id) return true; // own ⊂ team
      return sharesTeam(tx, principal, workspaceId, ownerId);
    }
  }
}

async function sharesTeam(
  tx: Parameters<Parameters<typeof withSystemTx>[0]>[0],
  principal: Principal,
  workspaceId: string,
  ownerId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ userId: teamMembers.userId, teamId: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(
        eq(teams.workspaceId, workspaceId),
        eq(teamMembers.orgId, principal.orgId),
        inArray(teamMembers.userId, [principal.id, ownerId]),
      ),
    );

  const mine = new Set<string>();
  const theirs = new Set<string>();
  for (const r of rows) {
    if (r.userId === principal.id) mine.add(r.teamId);
    if (r.userId === ownerId) theirs.add(r.teamId);
  }
  for (const t of mine) if (theirs.has(t)) return true;
  return false;
}

/** Throwing variant for write paths that want to fail fast. */
export async function assertCan(
  principal: Principal,
  action: string,
  resource: ResourceRef,
  ctx: CanContext = {},
): Promise<void> {
  const decision = await can(principal, action, resource, ctx);
  if (!decision.allow) {
    throw AppError.permissionDenied(decision.reason, { action, resource });
  }
}
