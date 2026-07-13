import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeClock,
  registerMigrations,
  requestContext,
  setClock,
  systemClock,
  systemPrincipal,
  type Principal,
} from "@casper/platform";
import { setupTestDb, resetPlatform } from "@casper/platform/testkit";
import {
  authMigrations,
  createOrg,
  createUser,
  createWorkspace,
  createTeam,
  addToTeam,
  addMembership,
} from "@casper/auth";
import { eventsMigrations, getAuditLog, getTimeline } from "@casper/events";
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
  getWorkflow,
  evaluate,
  transition,
  scanSla,
  resolveAssignment,
} from "./index.js";

// A product record type expressed purely as config — the workflow engine adds no
// deal-specific code. `stageEnteredAt` is the datetime the record entered its stage
// (stamped by `transition`); it backs stage-age SLA rules.
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
        { value: "proposal", label: "Proposal" },
        { value: "won", label: "Won" },
        { value: "lost", label: "Lost" },
      ],
    },
    { key: "stageEnteredAt", label: "Stage entered at", type: "datetime" },
    { key: "closeDate", label: "Close date", type: "date" },
    { key: "accountManager", label: "Account manager", type: "user" },
  ],
};

// The casper-sales-style pipeline as workflow config (built per-world because the
// fixed-assignment rule references a real user id).
function dealWorkflow(bobId: string) {
  return {
    recordType: "deal",
    version: 1,
    initialStage: "lead",
    stages: [
      { key: "lead", name: "Lead", category: "open", order: 0 },
      { key: "qualified", name: "Qualified", category: "open", order: 1 },
      { key: "proposal", name: "Proposal", category: "open", order: 2 },
      { key: "won", name: "Won", category: "won", order: 3 },
      { key: "lost", name: "Lost", category: "lost", order: 4 },
    ],
    transitions: [
      { from: "lead", to: "qualified" },
      { from: "qualified", to: "proposal", guard: { requiredFields: ["amount", "closeDate"] } },
      { from: "proposal", to: "won", guard: { condition: { field: "amount", op: "gte", value: 100000 } } },
      // On-transition assignment: by_field (owner ← accountManager) and fixed.
      { from: "lead", to: "lost", assign: { strategy: "by_field", field: "owner", sourceField: "accountManager" } },
      { from: "qualified", to: "won", assign: { strategy: "fixed", field: "owner", userId: bobId } },
      // Relative-date guard — proves `now` gates the transition.
      { from: "qualified", to: "lost", guard: { condition: { field: "created_at", op: "within_last", value: { amount: 1, unit: "day" } } } },
    ],
    sla: [
      { key: "stale_deal", kind: "inactivity", threshold: { amount: 7, unit: "day" } },
      { key: "aging_qualified", kind: "stage_age", stage: "qualified", threshold: { amount: 14, unit: "day" }, event: "record.neglected" },
    ],
  };
}

interface World {
  orgId: string;
  wsId: string;
  alice: Principal;
  bob: Principal;
  manager: Principal;
}

async function seedWorld(name: string): Promise<World> {
  const org = await createOrg(name);
  const ws = await createWorkspace(org.id, "Sales");
  const a = await createUser(`alice@${name}.test`, "Alice");
  const b = await createUser(`bob@${name}.test`, "Bob");
  const m = await createUser(`mgr@${name}.test`, "Manager");
  await addMembership({ orgId: org.id, workspaceId: ws.id, userId: a.id, role: "member" });
  await addMembership({ orgId: org.id, workspaceId: ws.id, userId: b.id, role: "member" });
  await addMembership({ orgId: org.id, workspaceId: ws.id, userId: m.id, role: "manager" });
  // A team shared by Alice and the manager (Bob is intentionally not on it).
  const team = await createTeam(org.id, ws.id, "West");
  await addToTeam(org.id, team.id, a.id);
  await addToTeam(org.id, team.id, m.id);
  return {
    orgId: org.id,
    wsId: ws.id,
    alice: { kind: "user", id: a.id, orgId: org.id, workspaceId: ws.id },
    bob: { kind: "user", id: b.id, orgId: org.id, workspaceId: ws.id },
    manager: { kind: "user", id: m.id, orgId: org.id, workspaceId: ws.id },
  };
}

function asAlice<T>(w: World, fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ principal: w.alice }, fn);
}

describe("workflow engine (P1a)", () => {
  let w: World;

  beforeEach(async () => {
    registerMigrations(authMigrations);
    registerMigrations(eventsMigrations);
    registerRecordsModule();
    registerWorkflowModule();
    await setupTestDb();
    defineRecordType(dealType);
    w = await seedWorld("acme");
    defineWorkflow(dealWorkflow(w.bob.id));
  });

  afterEach(() => {
    resetRegistry();
    resetWorkflowRegistry();
    resetPlatform();
    setClock(systemClock);
  });

  // ---- pure core (D-014) ----------------------------------------------------

  it("evaluate() is pure: returns effects, touches no DB, reads no clock", () => {
    const defn = getWorkflow("deal");
    const snapshot = {
      id: "00000000-0000-0000-0000-000000000abc",
      type: "deal",
      ownerId: w.alice.id,
      data: { stage: "lead", name: "Globex" },
      lastActivityAt: null,
    };

    // A stale system clock must NOT leak in — the `now` argument is authoritative.
    setClock(new FakeClock("2000-01-01T00:00:00.000Z"));
    const r1 = evaluate(defn, snapshot, { kind: "transition", toStage: "qualified" }, new Date("2021-05-01T00:00:00.000Z"));
    const r2 = evaluate(defn, snapshot, { kind: "transition", toStage: "qualified" }, new Date("2022-09-09T00:00:00.000Z"));

    expect(r1.status).toBe("allowed");
    expect(r2.status).toBe("allowed");
    if (r1.status !== "allowed" || r2.status !== "allowed") throw new Error("unreachable");

    expect(r1.effects).toContainEqual({ kind: "set_stage", field: "stage", from: "lead", to: "qualified" });
    // Only the stamped time differs between the two calls — proof `now` flows in.
    const t1 = r1.effects.find((e) => e.kind === "set_field");
    const t2 = r2.effects.find((e) => e.kind === "set_field");
    expect(t1).toMatchObject({ field: "stageEnteredAt", value: "2021-05-01T00:00:00.000Z" });
    expect(t2).toMatchObject({ field: "stageEnteredAt", value: "2022-09-09T00:00:00.000Z" });
  });

  it("evaluate() gates on a relative-date condition using `now`", () => {
    const defn = getWorkflow("deal");
    const snapshot = {
      id: "00000000-0000-0000-0000-000000000def",
      type: "deal",
      ownerId: w.alice.id,
      data: { stage: "qualified", name: "Initech" },
      createdAt: "2023-01-01T00:00:00.000Z",
      lastActivityAt: null,
    };

    // within_last 1 day of created_at: true just after creation, false two days on.
    const soon = evaluate(defn, snapshot, { kind: "transition", toStage: "lost" }, new Date("2023-01-01T06:00:00.000Z"));
    const later = evaluate(defn, snapshot, { kind: "transition", toStage: "lost" }, new Date("2023-01-03T00:00:00.000Z"));
    expect(soon.status).toBe("allowed");
    expect(later.status).toBe("blocked");
    if (later.status !== "blocked") throw new Error("unreachable");
    expect(later.violations[0]?.code).toBe("condition_unmet");
  });

  // ---- transition API -------------------------------------------------------

  it("transitions legally through the stage model, stamping stageEnteredAt", async () => {
    setClock(new FakeClock("2026-03-01T00:00:00.000Z"));
    const rec = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Globex" } }));
    expect(rec.data.stage).toBe("lead");

    const moved = await asAlice(w, () => transition({ type: "deal", id: rec.id, toStage: "qualified", baseVersion: 1 }));
    expect(moved.data.stage).toBe("qualified");
    expect(moved.data.stageEnteredAt).toBe("2026-03-01T00:00:00.000Z");
    expect(moved.version).toBe(2);
  });

  it("rejects an illegal transition and leaves the record unchanged", async () => {
    const rec = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Umbrella" } }));
    await expect(
      asAlice(w, () => transition({ type: "deal", id: rec.id, toStage: "won" })),
    ).rejects.toMatchObject({ code: "invalid_state" });

    const after = await asAlice(w, () => getRecord("deal", rec.id));
    expect(after?.data.stage).toBe("lead");
    expect(after?.version).toBe(1);
  });

  it("enforces the required-fields guard", async () => {
    const rec = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Contoso" } }));
    await asAlice(w, () => transition({ type: "deal", id: rec.id, toStage: "qualified" }));

    // qualified → proposal needs amount + closeDate.
    await expect(
      asAlice(w, () => transition({ type: "deal", id: rec.id, toStage: "proposal" })),
    ).rejects.toMatchObject({ code: "validation_failed" });

    await asAlice(w, () =>
      updateRecord({ type: "deal", id: rec.id, patch: { amount: { amount: 5000, currency: "USD" }, closeDate: "2026-12-31" } }),
    );
    const moved = await asAlice(w, () => transition({ type: "deal", id: rec.id, toStage: "proposal" }));
    expect(moved.data.stage).toBe("proposal");
  });

  it("enforces the condition guard (in-memory Filter over the record)", async () => {
    // Small deal: proposal → won blocked (amount < 100k).
    const small = await asAlice(w, () =>
      createRecord({ type: "deal", data: { name: "Small", amount: { amount: 50000, currency: "USD" }, closeDate: "2026-12-31" } }),
    );
    await asAlice(w, () => transition({ type: "deal", id: small.id, toStage: "qualified" }));
    await asAlice(w, () => transition({ type: "deal", id: small.id, toStage: "proposal" }));
    await expect(
      asAlice(w, () => transition({ type: "deal", id: small.id, toStage: "won" })),
    ).rejects.toMatchObject({ code: "invalid_state" });

    // Big deal: the same transition is allowed.
    const big = await asAlice(w, () =>
      createRecord({ type: "deal", data: { name: "Big", amount: { amount: 250000, currency: "USD" }, closeDate: "2026-12-31" } }),
    );
    await asAlice(w, () => transition({ type: "deal", id: big.id, toStage: "qualified" }));
    await asAlice(w, () => transition({ type: "deal", id: big.id, toStage: "proposal" }));
    const won = await asAlice(w, () => transition({ type: "deal", id: big.id, toStage: "won" }));
    expect(won.data.stage).toBe("won");
  });

  it("enforces the permission guard: non-owner off-team is denied, manager on-team allowed", async () => {
    const rec = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Wayne Ent" } }));

    // Bob is a member and not the owner nor on Alice's team → denied.
    await expect(
      requestContext.run({ principal: w.bob }, () => transition({ type: "deal", id: rec.id, toStage: "qualified" })),
    ).rejects.toMatchObject({ code: "permission_denied" });

    // The manager shares a team with Alice → allowed (record.transition @ team).
    const moved = await requestContext.run({ principal: w.manager }, () =>
      transition({ type: "deal", id: rec.id, toStage: "qualified" }),
    );
    expect(moved.data.stage).toBe("qualified");
  });

  it("emits <type>.stage_changed alongside the records write", async () => {
    const rec = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Northwind" } }));
    await asAlice(w, () => transition({ type: "deal", id: rec.id, toStage: "qualified" }));

    const audit = await asAlice(w, () => getAuditLog({ subject: { type: "deal", id: rec.id } }));
    const types = audit.map((a) => a.type);
    expect(types).toContain("deal.updated");
    expect(types).toContain("deal.stage_changed");

    const timeline = await asAlice(w, () => getTimeline({ type: "deal", id: rec.id }));
    expect(timeline.some((t) => t.kind === "stage_changed")).toBe(true);
  });

  // ---- assignment -----------------------------------------------------------

  it("resolveAssignment is pure over fixed and by_field strategies", () => {
    expect(resolveAssignment({ strategy: "fixed", field: "owner", userId: w.bob.id }, { ownerId: w.alice.id, data: {} })).toBe(w.bob.id);
    expect(resolveAssignment({ strategy: "by_field", field: "owner", sourceField: "accountManager" }, { ownerId: w.alice.id, data: { accountManager: w.bob.id } })).toBe(w.bob.id);
    expect(resolveAssignment({ strategy: "by_field", field: "owner", sourceField: "accountManager" }, { ownerId: w.alice.id, data: {} })).toBeNull();
  });

  it("applies on-transition assignment through the records write path", async () => {
    // fixed: qualified → won reassigns ownership to Bob.
    const fixed = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Fixed" } }));
    await asAlice(w, () => transition({ type: "deal", id: fixed.id, toStage: "qualified" }));
    const won = await asAlice(w, () => transition({ type: "deal", id: fixed.id, toStage: "won" }));
    expect(won.ownerId).toBe(w.bob.id);

    // by_field: lead → lost assigns owner from the accountManager field.
    const byField = await asAlice(w, () => createRecord({ type: "deal", data: { name: "ByField", accountManager: w.bob.id } }));
    const lost = await asAlice(w, () => transition({ type: "deal", id: byField.id, toStage: "lost" }));
    expect(lost.ownerId).toBe(w.bob.id);
  });

  // ---- SLA / staleness scan -------------------------------------------------

  it("SLA inactivity scan emits for neglected records only", async () => {
    // A neglected deal (last activity long ago) and a fresh one.
    setClock(new FakeClock("2020-01-01T00:00:00.000Z"));
    const neglected = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Neglected" } }));
    setClock(systemClock);
    await asAlice(w, () => createRecord({ type: "deal", data: { name: "Fresh" } }));

    const breaches = await runScan(w, "deal");
    const inactivity = breaches.filter((b) => b.ruleKey === "stale_deal");
    expect(inactivity.map((b) => b.recordId)).toEqual([neglected.id]);

    const audit = await asAlice(w, () => getAuditLog({ subject: { type: "deal", id: neglected.id } }));
    expect(audit.map((a) => a.type)).toContain("workflow.sla_breached");
  });

  it("SLA stage-age scan emits for records aged in-stage only", async () => {
    // Aged: entered `qualified` back in 2020.
    setClock(new FakeClock("2020-01-01T00:00:00.000Z"));
    const aged = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Aged" } }));
    await asAlice(w, () => transition({ type: "deal", id: aged.id, toStage: "qualified" }));
    // Fresh: entered `qualified` just now.
    setClock(systemClock);
    const fresh = await asAlice(w, () => createRecord({ type: "deal", data: { name: "FreshQ" } }));
    await asAlice(w, () => transition({ type: "deal", id: fresh.id, toStage: "qualified" }));

    const breaches = await runScan(w, "deal");
    const stageAge = breaches.filter((b) => b.ruleKey === "aging_qualified").map((b) => b.recordId);
    expect(stageAge).toContain(aged.id);
    expect(stageAge).not.toContain(fresh.id);
  });

  // ---- tenant isolation -----------------------------------------------------

  it("isolates tenants: another org's scan sees none of the first org's records", async () => {
    setClock(new FakeClock("2020-01-01T00:00:00.000Z"));
    await asAlice(w, () => createRecord({ type: "deal", data: { name: "Secret" } }));
    setClock(systemClock);

    const other = await seedWorld("initech");
    const breaches = await runScan(other, "deal");
    expect(breaches).toEqual([]);
  });
});

/** Run the SLA scan the way the cron will: a system principal scoped to a workspace. */
function runScan(w: World, type: string) {
  return requestContext.run(
    { principal: systemPrincipal(w.orgId, w.wsId), workspaceId: w.wsId },
    () => scanSla({ type }),
  );
}
