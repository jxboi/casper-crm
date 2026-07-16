import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  registerMigrations,
  requestContext,
  setClock,
  systemClock,
  withSystemTx,
  type Principal,
} from "@casper/platform";
import { setupTestDb, resetPlatform } from "@casper/platform/testkit";
import {
  authMigrations,
  createOrg,
  createUser,
  createWorkspace,
  addMembership,
} from "@casper/auth/testkit";
import { eventsMigrations, schema as eventsSchema } from "@casper/events";
import {
  registerRecordsModule,
  defineRecordType,
  resetRegistry,
  createRecord,
  updateRecord,
  getRecord,
  type RecordTypeDef,
} from "@casper/records";
import {
  registerWorkflowModule,
  defineWorkflow,
  resetWorkflowRegistry,
  getActiveVersion,
  getWorkflow,
} from "@casper/workflow";
import {
  registerChangesetsModule,
  createChangeSet,
  addChange,
  submitForReview,
  approveChange,
  approveAll,
  commitChangeSet,
  getChangeSet,
  listChangeSets,
  readThroughChangeset,
  previewChangeSet,
} from "./index.js";

const dealType: RecordTypeDef = {
  key: "deal",
  name: { singular: "Deal", plural: "Deals" },
  origin: "product",
  primaryField: "name",
  version: 1,
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "amount", label: "Amount", type: "money" },
    {
      key: "stage",
      label: "Stage",
      type: "select",
      default: "lead",
      options: [
        { value: "lead", label: "Lead" },
        { value: "qualified", label: "Qualified" },
        { value: "won", label: "Won" },
        { value: "lost", label: "Lost" },
      ],
    },
    { key: "stageEnteredAt", label: "Stage entered at", type: "datetime" },
  ],
};

function dealWorkflowV1() {
  return {
    recordType: "deal",
    version: 1,
    initialStage: "lead",
    stages: [
      { key: "lead", name: "Lead", category: "open", order: 0 },
      { key: "qualified", name: "Qualified", category: "open", order: 1 },
      { key: "won", name: "Won", category: "won", order: 2 },
      { key: "lost", name: "Lost", category: "lost", order: 3 },
    ],
    transitions: [
      { from: "lead", to: "qualified" },
      { from: "qualified", to: "won" },
    ],
    sla: [],
  };
}

// v2 adds a "proposal" stage — a structural config change to publish.
function dealWorkflowV2() {
  const v1 = dealWorkflowV1();
  return {
    ...v1,
    stages: [
      ...v1.stages.slice(0, 2),
      { key: "proposal", name: "Proposal", category: "open", order: 2 },
      ...v1.stages.slice(2),
    ],
    transitions: [
      { from: "lead", to: "qualified" },
      { from: "qualified", to: "proposal" },
      { from: "proposal", to: "won" },
    ],
  };
}

interface World {
  orgId: string;
  wsId: string;
  alice: Principal; // member (author of record changes)
  admin: Principal; // workspace_admin (can publish + approve)
  manager: Principal; // manager (can approve, not publish)
}

async function seedWorld(name: string, seats = 3): Promise<World> {
  const org = await createOrg(name);
  const ws = await createWorkspace(org.id, "Sales");
  const a = await createUser(`alice@${name}.test`, "Alice");
  await addMembership({ orgId: org.id, workspaceId: ws.id, userId: a.id, role: "member" });
  const admin = await createUser(`admin@${name}.test`, "Admin");
  const mgr = await createUser(`mgr@${name}.test`, "Manager");
  if (seats >= 2) await addMembership({ orgId: org.id, workspaceId: ws.id, userId: admin.id, role: "workspace_admin" });
  if (seats >= 3) await addMembership({ orgId: org.id, workspaceId: ws.id, userId: mgr.id, role: "manager" });
  return {
    orgId: org.id,
    wsId: ws.id,
    alice: { kind: "user", id: a.id, orgId: org.id, workspaceId: ws.id },
    admin: { kind: "user", id: admin.id, orgId: org.id, workspaceId: ws.id },
    manager: { kind: "user", id: mgr.id, orgId: org.id, workspaceId: ws.id },
  };
}

function as<T>(p: Principal, fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ principal: p }, fn);
}

async function causationOf(type: string, subjectId: string): Promise<string | null> {
  const rows = await withSystemTx((tx) =>
    tx
      .select({ causationId: eventsSchema.domainEvents.causationId })
      .from(eventsSchema.domainEvents)
      .where(
        and(
          eq(eventsSchema.domainEvents.type, type),
          eq(eventsSchema.domainEvents.subjectId, subjectId),
        ),
      )
      .limit(1),
  );
  return rows[0]?.causationId ?? null;
}

describe("changesets engine (P1b)", () => {
  let w: World;

  beforeEach(async () => {
    registerMigrations(authMigrations);
    registerMigrations(eventsMigrations);
    registerRecordsModule();
    registerWorkflowModule();
    registerChangesetsModule();
    await setupTestDb();
    defineRecordType(dealType);
    defineWorkflow(dealWorkflowV1());
    w = await seedWorld("acme");
  });

  afterEach(() => {
    resetRegistry();
    resetWorkflowRegistry();
    resetPlatform();
    setClock(systemClock);
  });

  it("computes risk and validates through the owning module at draft time", async () => {
    const rec = await as(w.alice, () => createRecord({ type: "deal", data: { name: "Globex" } }));

    const { id: csId } = await as(w.alice, () => createChangeSet({ title: "Edit deal", origin: "manual" }));

    // Valid update — medium risk.
    const good = await as(w.alice, () =>
      addChange(csId, { op: "update", target: { kind: "record", type: "deal", id: rec.id }, payload: { stage: "qualified" } }),
    );
    expect(good.risk).toBe("medium");
    expect(good.validation.ok).toBe(true);

    // Invalid update (unknown stage) — flagged at draft time, not commit.
    const bad = await as(w.alice, () =>
      addChange(csId, { op: "update", target: { kind: "record", type: "deal", id: rec.id }, payload: { stage: "bogus" } }),
    );
    expect(bad.validation.ok).toBe(false);

    // config_publish is high risk.
    const pub = await as(w.admin, () =>
      addChange(csId, { op: "config_publish", target: { kind: "config", configType: "workflow", recordType: "deal" }, payload: dealWorkflowV2() }),
    );
    expect(pub.risk).toBe("high");
  });

  it("gates config_publish authoring on workflow.publish", async () => {
    const { id: csId } = await as(w.alice, () => createChangeSet({ title: "Publish", origin: "workflow_publish" }));
    await expect(
      as(w.alice, () =>
        addChange(csId, { op: "config_publish", target: { kind: "config", configType: "workflow", recordType: "deal" }, payload: dealWorkflowV2() }),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("enforces approval gating and no-self-approval for high-risk in multi-seat orgs", async () => {
    const { id: csId } = await as(w.admin, () => createChangeSet({ title: "Publish v2", origin: "workflow_publish" }));
    const pub = await as(w.admin, () =>
      addChange(csId, { op: "config_publish", target: { kind: "config", configType: "workflow", recordType: "deal" }, payload: dealWorkflowV2() }),
    );
    await as(w.admin, () => submitForReview(csId));

    // A plain member cannot approve at all.
    await expect(
      as(w.alice, () => approveChange(csId, pub.id)),
    ).rejects.toMatchObject({ code: "permission_denied" });

    // The author (admin) cannot self-approve their own high-risk change (3 seats).
    await expect(
      as(w.admin, () => approveChange(csId, pub.id)),
    ).rejects.toMatchObject({ code: "permission_denied" });

    // A different approver (manager) can.
    await as(w.manager, () => approveChange(csId, pub.id));
    const cs = await as(w.admin, () => getChangeSet(csId));
    expect(cs.changes[0]?.approval).toBe("approved");
  });

  it("allows single-seat self-approval (dogfood exemption, D-017)", async () => {
    // A one-seat org whose sole member is a workspace_admin: they may author a
    // high-risk publish and approve it themselves.
    const org = await createOrg("solo");
    const ws = await createWorkspace(org.id, "Sales");
    const founder = await createUser("founder@solo.test", "Founder");
    await addMembership({ orgId: org.id, workspaceId: ws.id, userId: founder.id, role: "workspace_admin" });
    const p: Principal = { kind: "user", id: founder.id, orgId: org.id, workspaceId: ws.id };

    const { id: csId } = await as(p, () => createChangeSet({ title: "Solo publish", origin: "workflow_publish" }));
    const pub = await as(p, () =>
      addChange(csId, { op: "config_publish", target: { kind: "config", configType: "workflow", recordType: "deal" }, payload: dealWorkflowV2() }),
    );
    await as(p, () => submitForReview(csId));
    // Self-approval of a high-risk change is allowed because the org has one seat.
    await as(p, () => approveChange(csId, pub.id));
    const cs = await as(p, () => getChangeSet(csId));
    expect(cs.changes[0]?.approval).toBe("approved");
  });

  it("commits through module write APIs; applied events carry the changeset causation id", async () => {
    const rec = await as(w.alice, () => createRecord({ type: "deal", data: { name: "Initech" } }));
    const { id: csId } = await as(w.alice, () => createChangeSet({ title: "Advance", origin: "manual" }));
    await as(w.alice, () =>
      addChange(csId, { op: "update", target: { kind: "record", type: "deal", id: rec.id }, payload: { stage: "qualified" } }),
    );
    await as(w.alice, () => submitForReview(csId));
    await as(w.manager, () => approveAll(csId));
    const { appliedChangeIds } = await as(w.manager, () => commitChangeSet(csId));
    expect(appliedChangeIds).toHaveLength(1);

    const after = await as(w.alice, () => getRecord("deal", rec.id));
    expect(after?.data.stage).toBe("qualified");

    // The applied write emitted deal.updated with causationId = the change set.
    expect(await causationOf("deal.updated", rec.id)).toBe(csId);
  });

  it("commits a config_publish: a new workflow version becomes active", async () => {
    expect(getActiveVersion("deal")).toBe(1);
    const { id: csId } = await as(w.admin, () => createChangeSet({ title: "Publish v2", origin: "workflow_publish" }));
    await as(w.admin, () =>
      addChange(csId, { op: "config_publish", target: { kind: "config", configType: "workflow", recordType: "deal" }, payload: dealWorkflowV2() }),
    );
    await as(w.admin, () => submitForReview(csId));
    await as(w.manager, () => approveAll(csId));
    await as(w.manager, () => commitChangeSet(csId));

    expect(getActiveVersion("deal")).toBe(2);
    expect(getWorkflow("deal").stages.some((s) => s.key === "proposal")).toBe(true);
  });

  it("blocks commit when a change's base version has drifted (stale)", async () => {
    const rec = await as(w.alice, () => createRecord({ type: "deal", data: { name: "Umbrella" } }));
    const { id: csId } = await as(w.alice, () => createChangeSet({ title: "Stale edit", origin: "manual" }));
    await as(w.alice, () =>
      addChange(csId, { op: "update", target: { kind: "record", type: "deal", id: rec.id }, payload: { stage: "qualified" } }),
    );
    await as(w.alice, () => submitForReview(csId));
    await as(w.manager, () => approveAll(csId));

    // Concurrent out-of-band edit bumps the record version.
    await as(w.alice, () => updateRecord({ type: "deal", id: rec.id, patch: { name: "Umbrella Corp" } }));

    await expect(as(w.manager, () => commitChangeSet(csId))).rejects.toMatchObject({ code: "conflict" });
    // The stale change is flagged (validation marked not-ok) and nothing was applied.
    const cs = await as(w.manager, () => getChangeSet(csId));
    expect(cs.changes[0]?.validation.ok).toBe(false);
    expect(cs.changes[0]?.appliedAt).toBeNull();
    const after = await as(w.alice, () => getRecord("deal", rec.id));
    expect(after?.data.stage).toBe("lead");
  });

  it("overlay reads merge pending ops; preview reports diffs and a risk histogram", async () => {
    const rec = await as(w.alice, () => createRecord({ type: "deal", data: { name: "Contoso", stage: "lead" } }));
    const { id: csId } = await as(w.alice, () => createChangeSet({ title: "Preview", origin: "manual" }));
    await as(w.alice, () =>
      addChange(csId, { op: "update", target: { kind: "record", type: "deal", id: rec.id }, payload: { stage: "qualified" } }),
    );
    await as(w.admin, () =>
      addChange(csId, { op: "config_publish", target: { kind: "config", configType: "workflow", recordType: "deal" }, payload: dealWorkflowV2() }),
    );

    const overlay = await as(w.alice, () => readThroughChangeset(csId, { type: "deal", id: rec.id }));
    expect(overlay.data.stage).toBe("qualified"); // pending, not yet committed
    expect(overlay.base?.data.stage).toBe("lead"); // live unchanged

    const preview = await as(w.alice, () => previewChangeSet(csId));
    expect(preview.summary.risk).toMatchObject({ medium: 1, high: 1 });
    const configChange = preview.changes.find((c) => c.op === "config_publish");
    expect(configChange?.configDiff?.some((line) => line.includes("proposal"))).toBe(true);
  });

  it("lists a workspace's change sets newest-first, isolated by workspace and filterable by status", async () => {
    const older = await as(w.alice, () => createChangeSet({ title: "Older", origin: "manual" }));
    const newer = await as(w.alice, () => createChangeSet({ title: "Newer", origin: "manual" }));
    await as(w.alice, () => submitForReview(newer.id));

    // A change set in a different workspace must not leak into this list.
    const other = await seedWorld("globex");
    await as(other.alice, () => createChangeSet({ title: "Other org", origin: "manual" }));

    const all = await as(w.alice, () => listChangeSets());
    expect(all.map((cs) => cs.id)).toEqual([newer.id, older.id]); // newest first, acme only

    const inReview = await as(w.alice, () => listChangeSets({ status: ["in_review"] }));
    expect(inReview.map((cs) => cs.id)).toEqual([newer.id]);
  });
});
