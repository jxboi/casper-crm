import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerMigrations, requestContext, type Principal } from "@casper/platform";
import { resetPlatform, setupTestDb } from "@casper/platform/testkit";
import { authMigrations } from "./migrations.js";
import {
  addMembership,
  createOrg,
  createUser,
  createWorkspace,
} from "./testkit.js";
import {
  acceptInvitation,
  inviteMember,
  resolvePrincipal,
} from "./service.js";

describe("workspace invitations", () => {
  let orgId: string;
  let workspaceId: string;
  let admin: Principal;
  let member: Principal;

  beforeEach(async () => {
    registerMigrations(authMigrations);
    await setupTestDb();
    const org = await createOrg("Acme");
    const workspace = await createWorkspace(org.id, "Sales");
    const adminUser = await createUser("admin@acme.test", "Admin");
    const memberUser = await createUser("member@acme.test", "Member");
    orgId = org.id;
    workspaceId = workspace.id;
    await addMembership({ orgId, workspaceId, userId: adminUser.id, role: "workspace_admin" });
    await addMembership({ orgId, workspaceId, userId: memberUser.id, role: "member" });
    admin = { kind: "user", id: adminUser.id, orgId, workspaceId };
    member = { kind: "user", id: memberUser.id, orgId, workspaceId };
  });

  afterEach(() => resetPlatform());

  it("requires member.invite and accepts only for the matching identity", async () => {
    await expect(
      requestContext.run({ principal: member }, () =>
        inviteMember({ email: "new@acme.test", role: "member" }),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });

    const invite = await requestContext.run({ principal: admin }, () =>
      inviteMember({ email: "new@acme.test", role: "manager" }),
    );
    const wrong = await createUser("wrong@acme.test", "Wrong");
    await expect(
      requestContext.run(
        { principal: { kind: "user", id: wrong.id, orgId, workspaceId } },
        () => acceptInvitation(invite.id),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });

    const invited = await createUser("new@acme.test", "New Member");
    await requestContext.run(
      { principal: { kind: "user", id: invited.id, orgId, workspaceId } },
      () => acceptInvitation(invite.id),
    );
    const resolved = await resolvePrincipal(invited.id, workspaceId);
    expect(resolved.workspaceId).toBe(workspaceId);
    expect(resolved.principal.id).toBe(invited.id);
  });
});
