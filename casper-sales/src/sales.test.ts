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
} from "@casper/auth";
import { eventsMigrations, getAuditLog } from "@casper/events";
import {
  registerRecordsModule,
  resetRegistry,
  createRecord,
  updateRecord,
  getRecord,
  listRecords,
  listSavedViews,
  getReferencing,
} from "@casper/records";
import {
  registerWorkflowModule,
  resetWorkflowRegistry,
  resetAutomationRegistry,
  transition,
  scanSla,
  runPendingAutomations,
} from "@casper/workflow";
import {
  registerSalesModule,
  seedSalesData,
  NEGLECTED_DEALS_FILTER,
} from "./index.js";

interface World {
  orgId: string;
  wsId: string;
  alice: Principal;
}

async function seedWorld(name: string): Promise<World> {
  const org = await createOrg(name);
  const ws = await createWorkspace(org.id, "Sales");
  const a = await createUser(`alice@${name}.test`, "Alice");
  await addMembership({ orgId: org.id, workspaceId: ws.id, userId: a.id, role: "manager" });
  return {
    orgId: org.id,
    wsId: ws.id,
    alice: { kind: "user", id: a.id, orgId: org.id, workspaceId: ws.id },
  };
}

function asAlice<T>(w: World, fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ principal: w.alice }, fn);
}

describe("casper-sales — product config over the engine (P1a)", () => {
  let w: World;

  beforeEach(async () => {
    registerMigrations(authMigrations);
    registerMigrations(eventsMigrations);
    registerRecordsModule();
    registerWorkflowModule();
    await setupTestDb();
    // The whole product surface — types, pipeline, automations — is registered here
    // with no migrations of its own: the engine/product split (plan §Purpose).
    registerSalesModule();
    w = await seedWorld("acme");
  });

  afterEach(() => {
    resetRegistry();
    resetWorkflowRegistry();
    resetAutomationRegistry();
    resetPlatform();
    setClock(systemClock);
  });

  it("defines Contact/Company/Deal and writes a deal through the records engine (zero engine change)", async () => {
    const { company, deal } = await asAlice(w, async () => {
      const company = await createRecord({
        type: "company",
        data: { name: "Globex", domain: "globex.com", industry: "saas" },
      });
      const deal = await createRecord({
        type: "deal",
        data: { name: "Globex license", company: company.id, amount: { amount: 5_000_000, currency: "SGD" } },
      });
      return { company, deal };
    });

    // Default stage applied from config; relation mirrored into the edge list.
    expect(deal.data.stage).toBe("new");
    const refs = await asAlice(w, () => getReferencing("company", company.id));
    expect(refs).toContainEqual(expect.objectContaining({ fromId: deal.id, fieldKey: "company" }));
  });

  it("enforces the pipeline guard: qualified → proposal needs amount + expected close", async () => {
    const deal = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Guarded" } }));

    await asAlice(w, () => transition({ type: "deal", id: deal.id, toStage: "qualified" }));

    // Missing amount + expectedCloseDate → blocked as a validation error.
    await expect(
      asAlice(w, () => transition({ type: "deal", id: deal.id, toStage: "proposal" })),
    ).rejects.toMatchObject({ code: "validation_failed" });

    await asAlice(w, () =>
      updateRecord({
        type: "deal",
        id: deal.id,
        patch: { amount: { amount: 1_000_000, currency: "SGD" }, expectedCloseDate: "2026-09-01" },
      }),
    );
    const moved = await asAlice(w, () => transition({ type: "deal", id: deal.id, toStage: "proposal" }));
    expect(moved.data.stage).toBe("proposal");
    // The engine stamps stage-entry time on every transition.
    expect(typeof moved.data.stageEnteredAt).toBe("string");
  });

  it("requires a lost reason to enter Lost (reachable from any open stage)", async () => {
    const deal = await asAlice(w, () => createRecord({ type: "deal", data: { name: "Doomed" } }));

    await expect(
      asAlice(w, () => transition({ type: "deal", id: deal.id, toStage: "lost" })),
    ).rejects.toMatchObject({ code: "validation_failed" });

    await asAlice(w, () =>
      updateRecord({ type: "deal", id: deal.id, patch: { lostReason: "Budget cut" } }),
    );
    const lost = await asAlice(w, () => transition({ type: "deal", id: deal.id, toStage: "lost" }));
    expect(lost.data.stage).toBe("lost");
  });

  it("runs the Won automation: closing a deal creates the onboarding task", async () => {
    const deal = await asAlice(w, () =>
      createRecord({
        type: "deal",
        data: { name: "Winner", amount: { amount: 9_000_000, currency: "SGD" }, expectedCloseDate: "2026-10-01" },
      }),
    );

    await asAlice(w, () => transition({ type: "deal", id: deal.id, toStage: "qualified" }));
    await asAlice(w, () => transition({ type: "deal", id: deal.id, toStage: "proposal" }));
    await asAlice(w, () => transition({ type: "deal", id: deal.id, toStage: "negotiation" }));
    await asAlice(w, () => transition({ type: "deal", id: deal.id, toStage: "won" }));

    const processed = await runPendingAutomations();
    expect(processed).toBeGreaterThanOrEqual(1);

    const tasks = await asAlice(w, () => listRecords({ type: "task" }));
    expect(tasks.records).toHaveLength(1);
    expect(tasks.records[0]?.data.source).toBe("automation");
    expect(tasks.records[0]?.data.priority).toBe("high");
    expect(tasks.records[0]?.data.relatedTo).toMatchObject({ type: "deal", id: deal.id });
  });

  it("surfaces neglected deals via the config filter and the SLA scan; healthy/closed deals are excluded", async () => {
    await asAlice(w, () => seedSalesData({ variant: "demo" }));

    // The Neglected-deals view filter: two seeded deals qualify (overdue next action,
    // stuck-in-stage); the fresh/healthy and the Won deal do not.
    const neglected = await asAlice(w, () =>
      listRecords({ type: "deal", filter: NEGLECTED_DEALS_FILTER }),
    );
    const names = neglected.records.map((r) => r.data.name).sort();
    expect(names).toEqual(["Acme — spare parts contract", "Initech — treasury module"]);

    // The SLA scan finds the stuck-in-stage deal (stage_age > 30d) and emits
    // record.neglected — the assistant/notifications' trigger, defined as config.
    const breaches = await asAlice(w, () => scanSla({ type: "deal" }));
    expect(breaches.some((b) => b.kind === "stage_age")).toBe(true);
    const stuck = neglected.records.find((r) => r.data.name === "Acme — spare parts contract")!;
    const audit = await asAlice(w, () => getAuditLog({ subject: { type: "deal", id: stuck.id } }));
    expect(audit.map((a) => a.type)).toContain("record.neglected");
  });

  it("seeds default views + demo data idempotently, wiring relations", async () => {
    const first = await asAlice(w, () => seedSalesData({ variant: "demo" }));
    expect(first.skipped).toBe(false);
    expect(first.companies).toHaveLength(3);
    expect(first.deals).toHaveLength(5);

    // Default views exist and are visible to the workspace.
    const dealViews = await asAlice(w, () => listSavedViews("deal"));
    const viewNames = dealViews.map((v) => v.name).sort();
    expect(viewNames).toEqual(["My open deals", "Neglected deals", "Pipeline"]);

    // A company is referenced by its seeded contacts and deals (relation edges).
    const acme = first.companies.find((c) => c.data.name === "Acme Robotics")!;
    const refs = await asAlice(w, () => getReferencing("company", acme.id));
    expect(refs.some((r) => r.fromType === "contact")).toBe(true);
    expect(refs.some((r) => r.fromType === "deal")).toBe(true);

    // Re-running is a no-op for records (views already present, data already seeded).
    const second = await asAlice(w, () => seedSalesData({ variant: "demo" }));
    expect(second.skipped).toBe(true);
    expect(second.deals).toHaveLength(0);
    const companiesAfter = await asAlice(w, () => listRecords({ type: "company" }));
    expect(companiesAfter.records).toHaveLength(3);
  });
});
