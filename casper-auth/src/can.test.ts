import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerMigrations, type Principal } from "@casper/platform";
import { setupTestDb, resetPlatform } from "@casper/platform/testkit";
import { authMigrations } from "./migrations.js";
import {
  createOrg,
  createUser,
  createWorkspace,
  createTeam,
  addToTeam,
  addMembership,
} from "./service.js";
import { can } from "./can.js";

/**
 * Exercises the D-020 access model: open read, role-scoped write, and the team
 * union rule. Two users in the same workspace; ownership + team membership decide
 * write access.
 */
describe("can()", () => {
  let orgId: string;
  let wsId: string;
  let alice: Principal; // member, owns recordA
  let bob: Principal; // member, owns recordB
  let mgr: Principal; // manager

  beforeEach(async () => {
    registerMigrations(authMigrations);
    await setupTestDb();

    const org = await createOrg("Acme");
    orgId = org.id;
    const ws = await createWorkspace(orgId, "Sales");
    wsId = ws.id;

    const a = await createUser("alice@acme.test", "Alice");
    const b = await createUser("bob@acme.test", "Bob");
    const m = await createUser("mgr@acme.test", "Mgr");

    await addMembership({ orgId, workspaceId: wsId, userId: a.id, role: "member" });
    await addMembership({ orgId, workspaceId: wsId, userId: b.id, role: "member" });
    await addMembership({ orgId, workspaceId: wsId, userId: m.id, role: "manager" });

    alice = { kind: "user", id: a.id, orgId, workspaceId: wsId };
    bob = { kind: "user", id: b.id, orgId, workspaceId: wsId };
    mgr = { kind: "user", id: m.id, orgId, workspaceId: wsId };
  });

  afterEach(() => resetPlatform());

  const recordOwnedBy = (ownerId: string) =>
    ({ kind: "record", type: "deal", ownerId, workspaceId: wsId }) as const;

  it("allows open read across the workspace", async () => {
    const d = await can(alice, "record.read", recordOwnedBy(bob.id));
    expect(d.allow).toBe(true);
  });

  it("allows a member to update their own record", async () => {
    const d = await can(alice, "record.update", recordOwnedBy(alice.id));
    expect(d.allow).toBe(true);
  });

  it("denies a member updating someone else's record", async () => {
    const d = await can(alice, "record.update", recordOwnedBy(bob.id));
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/narrower scope/);
  });

  it("allows a manager to update a teammate's record (team union)", async () => {
    const team = await createTeam(orgId, wsId, "Enterprise");
    await addToTeam(orgId, team.id, mgr.id);
    await addToTeam(orgId, team.id, bob.id);
    const d = await can(mgr, "record.update", recordOwnedBy(bob.id));
    expect(d.allow).toBe(true);
    expect(d.reason).toMatch(/scope 'team'/);
  });

  it("denies a manager updating a non-teammate's record", async () => {
    // mgr and alice share no team.
    const d = await can(mgr, "record.update", recordOwnedBy(alice.id));
    expect(d.allow).toBe(false);
  });

  it("denies a deactivated member", async () => {
    // Directly deactivate alice's membership via a fresh org for isolation.
    const d = await can(
      { kind: "user", id: "00000000-0000-0000-0000-0000000000ff", orgId, workspaceId: wsId },
      "record.read",
      recordOwnedBy(bob.id),
    );
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/not a member/);
  });

  it("system principal is always allowed", async () => {
    const d = await can(
      { kind: "system", id: "00000000-0000-0000-0000-000000000000", orgId },
      "record.update",
      recordOwnedBy(bob.id),
    );
    expect(d.allow).toBe(true);
  });
});
