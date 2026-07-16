import {
  addMembership,
  authMigrations,
  createOrg,
  createUser,
  createWorkspace,
  schema,
  type BuiltinRole,
} from "@casper/auth/testkit";
import {
  createPgliteDb,
  getDb,
  hasDb,
  registerMigrations,
  runMigrations,
  setDb,
  withSystemTx,
  type Principal,
} from "@casper/platform";
import { eq } from "drizzle-orm";

export interface DevContext {
  orgId: string;
  workspaceId: string;
  principals: Array<{ label: string; role: BuiltinRole; principal: Principal }>;
}

/** Idempotent local-only tenant bootstrap for database-backed scenarios. */
export async function ensureDevContext(): Promise<DevContext> {
  if (process.env.NODE_ENV === "production") throw new Error("playground is disabled in production");
  if (process.env.DATABASE_URL) throw new Error("playground refuses DATABASE_URL; use isolated PGlite");
  if (!hasDb()) setDb(createPgliteDb(process.env.PLAYGROUND_PGLITE_DATA));
  registerMigrations(authMigrations);
  await runMigrations(getDb());
  const existing = await withSystemTx((tx) =>
    tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "owner@playground.local")).limit(1),
  );
  if (!existing[0]) {
    const org = await createOrg("Casper Playground");
    const workspace = await createWorkspace(org.id, "Sandbox");
    for (const role of ["org_owner", "org_admin", "workspace_admin", "manager", "member"] as const) {
      const user = await createUser(`${role}@playground.local`, role.replaceAll("_", " "));
      await addMembership({ orgId: org.id, workspaceId: workspace.id, userId: user.id, role });
    }
  }
  const owners = await withSystemTx((tx) =>
    tx.select({ userId: schema.users.id, orgId: schema.memberships.orgId, workspaceId: schema.memberships.workspaceId })
      .from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.users.email, "owner@playground.local")).limit(1),
  );
  const anchor = owners[0];
  if (!anchor) throw new Error("playground bootstrap failed");
  const members = await withSystemTx((tx) =>
    tx.select({ userId: schema.memberships.userId, role: schema.memberships.role })
      .from(schema.memberships).where(eq(schema.memberships.workspaceId, anchor.workspaceId)),
  );
  return {
    orgId: anchor.orgId,
    workspaceId: anchor.workspaceId,
    principals: members.map((m) => ({
      label: m.role.replaceAll("_", " "), role: m.role as BuiltinRole,
      principal: { kind: "user", id: m.userId, orgId: anchor.orgId, workspaceId: anchor.workspaceId },
    })),
  };
}
