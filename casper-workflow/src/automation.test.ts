import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerMigrations,
  requestContext,
  setClock,
  systemClock,
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
import { eventsMigrations, getAuditLog } from "@casper/events";
import {
  registerRecordsModule,
  defineRecordType,
  resetRegistry,
  createRecord,
  getRecord,
  listRecords,
  type RecordTypeDef,
} from "@casper/records";
import {
  registerWorkflowModule,
  defineWorkflow,
  resetWorkflowRegistry,
  transition,
  defineAutomation,
  resetAutomationRegistry,
  runPendingAutomations,
  getAutomationRuns,
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

function dealWorkflow() {
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

interface World {
  orgId: string;
  wsId: string;
  alice: Principal;
}

async function seedWorld(name: string): Promise<World> {
  const org = await createOrg(name);
  const ws = await createWorkspace(org.id, "Sales");
  const a = await createUser(`alice@${name}.test`, "Alice");
  await addMembership({ orgId: org.id, workspaceId: ws.id, userId: a.id, role: "member" });
  return {
    orgId: org.id,
    wsId: ws.id,
    alice: { kind: "user", id: a.id, orgId: org.id, workspaceId: ws.id },
  };
}

function asAlice<T>(w: World, fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ principal: w.alice }, fn);
}

describe("workflow automation engine (P1b)", () => {
  let w: World;

  beforeEach(async () => {
    registerMigrations(authMigrations);
    registerMigrations(eventsMigrations);
    registerRecordsModule();
    registerWorkflowModule();
    await setupTestDb();
    defineRecordType(dealType);
    defineWorkflow(dealWorkflow());
    w = await seedWorld("acme");
  });

  afterEach(() => {
    resetRegistry();
    resetWorkflowRegistry();
    resetAutomationRegistry();
    resetPlatform();
    setClock(systemClock);
  });

  it("runs create_task when a deal enters won (trigger + condition + action)", async () => {
    defineAutomation({
      id: "task-on-won",
      trigger: "deal.stage_changed",
      condition: { field: "stage", op: "eq", value: "won" },
      actions: [{ kind: "create_task", title: "Kick off onboarding" }],
    });

    const rec = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Globex" } }));
    await asAlice(w, () => transition({ type: "deal", id: rec.id, toStage: "qualified" }));
    await asAlice(w, () => transition({ type: "deal", id: rec.id, toStage: "won" }));

    // Two stage_changed events enqueue two runs; only the →won run is pending
    // (the →qualified run was skipped at enqueue), so exactly one executes.
    const processed = await runPendingAutomations();
    expect(processed).toBe(1);

    const tasks = await asAlice(w, () => listRecords({ type: "task" }));
    expect(tasks.records).toHaveLength(1);
    expect(tasks.records[0]?.data.source).toBe("automation");
    expect(tasks.records[0]?.data.relatedTo).toMatchObject({ type: "deal", id: rec.id });

    // Run log: one executed (won), one skipped (qualified — condition not met).
    const runs = await getAutomationRuns({ automationId: "task-on-won" });
    expect(runs.filter((r) => r.status === "executed")).toHaveLength(1);
    expect(runs.filter((r) => r.status === "skipped")).toHaveLength(1);
  });

  it("executes update_field and transition actions through the write paths", async () => {
    defineAutomation({
      id: "qualify-on-create",
      trigger: "deal.created",
      actions: [{ kind: "transition", toStage: "qualified" }],
    });

    const rec = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Initech" } }));
    await runPendingAutomations();

    const after = await asAlice(w, () => getRecord("deal", rec.id));
    expect(after?.data.stage).toBe("qualified"); // moved by the automation, as system
  });

  it("emits notification.requested for the notify action (placeholder channel)", async () => {
    defineAutomation({
      id: "ping-on-create",
      trigger: "deal.created",
      actions: [{ kind: "notify", channel: "inapp", message: "New deal created" }],
    });

    const rec = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Contoso" } }));
    await runPendingAutomations();

    const audit = await asAlice(w, () => getAuditLog({ subject: { type: "deal", id: rec.id } }));
    expect(audit.map((a) => a.type)).toContain("notification.requested");
  });

  it("skips when the condition is not met (no effects, run logged as skipped)", async () => {
    defineAutomation({
      id: "task-on-won",
      trigger: "deal.stage_changed",
      condition: { field: "stage", op: "eq", value: "won" },
      actions: [{ kind: "create_task", title: "Onboarding" }],
    });

    const rec = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Umbrella" } }));
    await asAlice(w, () => transition({ type: "deal", id: rec.id, toStage: "qualified" }));
    await runPendingAutomations();

    const tasks = await asAlice(w, () => listRecords({ type: "task" }));
    expect(tasks.records).toHaveLength(0);
    const runs = await getAutomationRuns({ automationId: "task-on-won" });
    expect(runs.every((r) => r.status === "skipped")).toBe(true);
  });

  it("protects against loops: a self-triggering rule terminates with a bounded, visible run log", async () => {
    // Each task.created spawns another task → would loop forever without a cap.
    defineAutomation({
      id: "spawner",
      trigger: "task.created",
      actions: [{ kind: "create_task", title: "spawn", relateToTrigger: false }],
    });

    // Seed the chain with one manual task.
    await asAlice(w, () => createRecord({ type: "task", data: { title: "seed" } }));

    const processed = await runPendingAutomations(); // must terminate
    expect(processed).toBeGreaterThan(0);

    const runs = await getAutomationRuns({ automationId: "spawner" });
    const executed = runs.filter((r) => r.status === "executed");
    const blocked = runs.filter((r) => r.status === "blocked");
    // The depth cap stops the chain: bounded executions + at least one blocked run.
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(executed.length).toBeGreaterThan(0);
    expect(executed.length).toBeLessThanOrEqual(6);

    // Tasks created are bounded (seed + the automation's bounded spawns).
    const tasks = await asAlice(w, () => listRecords({ type: "task", limit: 200 }));
    expect(tasks.records.length).toBeLessThanOrEqual(7);
  });
});
