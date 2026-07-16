import { eq, and } from "drizzle-orm";
import {
  newId,
  requestContext,
  withSystemTx,
  withTx,
  type Principal,
  AppError,
} from "@casper/platform";
import {
  organizations,
  users,
  workspaces,
  teams,
  teamMembers,
  memberships,
  invitations,
} from "./schema.js";
import type { BuiltinRole } from "./roles.js";
import { assertCan } from "./can.js";
import { isBuiltinRole } from "./roles.js";

/**
 * Tenancy provisioning helpers. In production these are the data layer under the
 * admin surface — human-direct, `can()`-gated and audited (D-023). Here they are
 * the primitives seeds, tests, and the (P0) admin API build on. They run as the
 * system principal (RLS bypass) because provisioning creates the very rows the
 * tenant context is later scoped by.
 */
export interface Org {
  id: string;
  name: string;
}

export async function provisionOrg(name: string, managerModel = "workspace"): Promise<Org> {
  const id = newId();
  await withSystemTx((tx) =>
    tx.insert(organizations).values({ id, name, managerModel }),
  );
  return { id, name };
}

export async function provisionUser(email: string, name: string): Promise<{ id: string }> {
  const id = newId();
  await withSystemTx((tx) => tx.insert(users).values({ id, email, name }));
  return { id };
}

/**
 * Provision the default tenant for a newly authenticated user. Better Auth has
 * already inserted the shared `users` row with the same UUID before this runs.
 * The membership check makes the hook safe to retry.
 */
export async function provisionInitialTenant(input: {
  userId: string;
  orgName: string;
  workspaceName: string;
}): Promise<{ orgId: string; workspaceId: string }> {
  return withSystemTx(async (tx) => {
    const existing = await tx
      .select({ orgId: memberships.orgId, workspaceId: memberships.workspaceId })
      .from(memberships)
      .where(and(eq(memberships.userId, input.userId), eq(memberships.status, "active")))
      .limit(1);
    if (existing[0]) return existing[0];

    const orgId = newId();
    const workspaceId = newId();
    await tx.insert(organizations).values({ id: orgId, name: input.orgName });
    await tx.insert(workspaces).values({ id: workspaceId, orgId, name: input.workspaceName });
    await tx.insert(memberships).values({
      id: newId(),
      orgId,
      workspaceId,
      userId: input.userId,
      role: "org_owner",
    });
    return { orgId, workspaceId };
  });
}

export interface ResolvedPrincipal {
  principal: Principal;
  orgId: string;
  workspaceId: string;
  userName: string;
}

/** Resolve an authenticated identity into an active workspace-scoped principal. */
export async function resolvePrincipal(
  userId: string,
  preferredWorkspaceId?: string,
): Promise<ResolvedPrincipal> {
  return withSystemTx(async (tx) => {
    const rows = await tx
      .select({
        orgId: memberships.orgId,
        workspaceId: memberships.workspaceId,
        userName: users.name,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
          ...(preferredWorkspaceId ? [eq(memberships.workspaceId, preferredWorkspaceId)] : []),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new AppError("permission_denied", "No active workspace membership");
    return {
      principal: {
        kind: "user",
        id: userId,
        orgId: row.orgId,
        workspaceId: row.workspaceId,
      },
      orgId: row.orgId,
      workspaceId: row.workspaceId,
      userName: row.userName,
    };
  });
}

export async function provisionWorkspace(orgId: string, name: string): Promise<{ id: string }> {
  const id = newId();
  await withSystemTx((tx) => tx.insert(workspaces).values({ id, orgId, name }));
  return { id };
}

export async function provisionTeam(
  orgId: string,
  workspaceId: string,
  name: string,
): Promise<{ id: string }> {
  const id = newId();
  await withSystemTx((tx) => tx.insert(teams).values({ id, orgId, workspaceId, name }));
  return { id };
}

export async function provisionTeamMember(
  orgId: string,
  teamId: string,
  userId: string,
): Promise<void> {
  await withSystemTx((tx) =>
    tx.insert(teamMembers).values({ orgId, teamId, userId }).onConflictDoNothing(),
  );
}

export async function provisionMembership(input: {
  orgId: string;
  workspaceId: string;
  userId: string;
  role: BuiltinRole;
}): Promise<{ id: string }> {
  const id = newId();
  await withSystemTx((tx) =>
    tx.insert(memberships).values({
      id,
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
    }),
  );
  return { id };
}

/** Tenant-facing workspace creation. Bootstrap helpers live only in the testkit export. */
export async function createWorkspace(name: string): Promise<{ id: string }> {
  const ctx = requestContext.require();
  await assertCan(ctx.principal, "workspace.create", { kind: "org" });
  const id = newId();
  await withTx((tx) => tx.insert(workspaces).values({ id, orgId: ctx.orgId, name }));
  return { id };
}

export async function createTeam(name: string, workspaceId?: string): Promise<{ id: string }> {
  const ctx = requestContext.require();
  const targetWorkspace = workspaceId ?? ctx.workspaceId ?? ctx.principal.workspaceId;
  if (!targetWorkspace) throw AppError.validation("team creation requires a workspace");
  await assertCan(ctx.principal, "team.manage", { kind: "workspace", id: targetWorkspace });
  const id = newId();
  await withTx((tx) =>
    tx.insert(teams).values({ id, orgId: ctx.orgId, workspaceId: targetWorkspace, name }),
  );
  return { id };
}

export async function addToTeam(input: {
  teamId: string;
  userId: string;
  workspaceId?: string;
}): Promise<void> {
  const ctx = requestContext.require();
  const workspaceId = input.workspaceId ?? ctx.workspaceId ?? ctx.principal.workspaceId;
  if (!workspaceId) throw AppError.validation("team management requires a workspace");
  await assertCan(ctx.principal, "team.manage", { kind: "workspace", id: workspaceId });
  await withTx((tx) =>
    tx
      .insert(teamMembers)
      .values({ orgId: ctx.orgId, teamId: input.teamId, userId: input.userId })
      .onConflictDoNothing(),
  );
}

export interface InvitationModel {
  id: string;
  orgId: string;
  workspaceId: string;
  email: string;
  role: BuiltinRole;
  status: "pending" | "accepted" | "revoked";
}

/** Create a workspace invite. The opaque UUID is the one-time acceptance token. */
export async function inviteMember(input: {
  email: string;
  role: BuiltinRole;
  workspaceId?: string;
}): Promise<InvitationModel> {
  const ctx = requestContext.require();
  const workspaceId = input.workspaceId ?? ctx.workspaceId ?? ctx.principal.workspaceId;
  if (!workspaceId) throw AppError.validation("an invitation requires a workspace");
  if (!isBuiltinRole(input.role)) throw AppError.validation("invalid invitation role");
  await assertCan(ctx.principal, "member.invite", { kind: "member", workspaceId });
  const id = newId();
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) throw AppError.validation("invalid invitation email");
  await withTx((tx) =>
    tx.insert(invitations).values({
      id,
      orgId: ctx.orgId,
      workspaceId,
      email,
      role: input.role,
    }),
  );
  return { id, orgId: ctx.orgId, workspaceId, email, role: input.role, status: "pending" };
}

/** Accept an invite for the signed-in identity; safe to retry after membership creation. */
export async function acceptInvitation(invitationId: string): Promise<{ workspaceId: string }> {
  const ctx = requestContext.require();
  return withSystemTx(async (tx) => {
    const rows = await tx
      .select({ invitation: invitations, userEmail: users.email })
      .from(invitations)
      .innerJoin(users, eq(users.id, ctx.principal.id))
      .where(eq(invitations.id, invitationId))
      .limit(1);
    const row = rows[0];
    if (!row) throw AppError.notFound("invitation not found");
    if (row.invitation.status === "accepted") {
      return { workspaceId: row.invitation.workspaceId };
    }
    if (row.invitation.status !== "pending") throw AppError.invalidState("invitation is not active");
    if (row.userEmail.toLowerCase() !== row.invitation.email.toLowerCase()) {
      throw AppError.permissionDenied("invitation email does not match signed-in user");
    }
    if (!isBuiltinRole(row.invitation.role)) throw AppError.invalidState("invitation role is invalid");
    await tx
      .insert(memberships)
      .values({
        id: newId(),
        orgId: row.invitation.orgId,
        workspaceId: row.invitation.workspaceId,
        userId: ctx.principal.id,
        role: row.invitation.role,
      })
      .onConflictDoNothing();
    await tx
      .update(invitations)
      .set({ status: "accepted" })
      .where(and(eq(invitations.id, invitationId), eq(invitations.status, "pending")));
    return { workspaceId: row.invitation.workspaceId };
  });
}

export async function changeMemberRole(input: {
  userId: string;
  role: BuiltinRole;
  workspaceId?: string;
}): Promise<void> {
  const ctx = requestContext.require();
  const workspaceId = input.workspaceId ?? ctx.workspaceId ?? ctx.principal.workspaceId;
  if (!workspaceId) throw AppError.validation("role change requires a workspace");
  await assertCan(ctx.principal, "member.role_change", {
    kind: "member",
    userId: input.userId,
    workspaceId,
  });
  const rows = await withTx((tx) =>
    tx
      .update(memberships)
      .set({ role: input.role })
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, input.userId)))
      .returning({ id: memberships.id }),
  );
  if (!rows[0]) throw AppError.notFound("membership not found");
}
