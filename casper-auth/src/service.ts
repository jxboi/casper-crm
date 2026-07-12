import { newId, withSystemTx } from "@casper/platform";
import {
  organizations,
  users,
  workspaces,
  teams,
  teamMembers,
  memberships,
} from "./schema.js";
import type { BuiltinRole } from "./roles.js";

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

export async function createOrg(name: string, managerModel = "workspace"): Promise<Org> {
  const id = newId();
  await withSystemTx((tx) =>
    tx.insert(organizations).values({ id, name, managerModel }),
  );
  return { id, name };
}

export async function createUser(email: string, name: string): Promise<{ id: string }> {
  const id = newId();
  await withSystemTx((tx) => tx.insert(users).values({ id, email, name }));
  return { id };
}

export async function createWorkspace(orgId: string, name: string): Promise<{ id: string }> {
  const id = newId();
  await withSystemTx((tx) => tx.insert(workspaces).values({ id, orgId, name }));
  return { id };
}

export async function createTeam(
  orgId: string,
  workspaceId: string,
  name: string,
): Promise<{ id: string }> {
  const id = newId();
  await withSystemTx((tx) => tx.insert(teams).values({ id, orgId, workspaceId, name }));
  return { id };
}

export async function addToTeam(
  orgId: string,
  teamId: string,
  userId: string,
): Promise<void> {
  await withSystemTx((tx) =>
    tx.insert(teamMembers).values({ orgId, teamId, userId }).onConflictDoNothing(),
  );
}

export async function addMembership(input: {
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
