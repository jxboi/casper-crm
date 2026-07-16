import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeClock,
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
import { eventsMigrations, getAuditLog, getTimeline } from "@casper/events";
import {
  registerRecordsModule,
  defineRecordType,
  resetRegistry,
  createRecord,
  updateRecord,
  archiveRecord,
  transitionOwner,
  listRecords,
  searchRecords,
  createSavedView,
  renderView,
  type RecordTypeDef,
  type RecordModel,
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
    { key: "closeDate", label: "Close date", type: "date" },
  ],
};

interface World {
  orgId: string;
  wsId: string;
  alice: Principal;
  bob: Principal;
}

async function seedWorld(name: string): Promise<World> {
  const org = await createOrg(name);
  const ws = await createWorkspace(org.id, "Sales");
  const a = await createUser(`alice@${name}.test`, "Alice");
  const b = await createUser(`bob@${name}.test`, "Bob");
  await addMembership({ orgId: org.id, workspaceId: ws.id, userId: a.id, role: "member" });
  await addMembership({ orgId: org.id, workspaceId: ws.id, userId: b.id, role: "member" });
  return {
    orgId: org.id,
    wsId: ws.id,
    alice: { kind: "user", id: a.id, orgId: org.id, workspaceId: ws.id },
    bob: { kind: "user", id: b.id, orgId: org.id, workspaceId: ws.id },
  };
}

function asAlice<T>(w: World, fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ principal: w.alice }, fn);
}

describe("records engine (P0)", () => {
  let w: World;

  beforeEach(async () => {
    registerMigrations(authMigrations);
    registerMigrations(eventsMigrations);
    registerRecordsModule();
    await setupTestDb();
    defineRecordType(dealType); // a new type as pure config — no engine change
    w = await seedWorld("acme");
  });

  afterEach(() => {
    resetRegistry();
    resetPlatform();
    setClock(systemClock);
  });

  it("writes through the single path: validate → persist → event → audit + timeline", async () => {
    const rec = await asAlice(w, () =>
      createRecord({
        type: "deal",
        data: { name: "Globex", amount: { amount: 500000, currency: "USD" }, stage: "lead" },
      }),
    );
    expect(rec.version).toBe(1);
    expect(rec.ownerId).toBe(w.alice.id);
    expect(rec.data.stage).toBe("lead");

    const audit = await asAlice(w, () => getAuditLog({ subject: { type: "deal", id: rec.id } }));
    expect(audit.map((a) => a.type)).toContain("deal.created");

    const timeline = await asAlice(w, () => getTimeline({ type: "deal", id: rec.id }));
    expect(timeline.at(0)?.summary).toBe("deal created");
  });

  it("rejects invalid data via the compiled validator", async () => {
    await expect(
      asAlice(w, () => createRecord({ type: "deal", data: { stage: "lead" } })),
    ).rejects.toMatchObject({ code: "validation_failed" });

    await expect(
      asAlice(w, () => createRecord({ type: "deal", data: { name: "X", stage: "bogus" } })),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("records field-level diffs on update and bumps version", async () => {
    const rec = await asAlice(w, () =>
      createRecord({ type: "deal", data: { name: "Initech", stage: "lead" } }),
    );
    const updated = await asAlice(w, () =>
      updateRecord({ type: "deal", id: rec.id, patch: { stage: "qualified" }, baseVersion: 1 }),
    );
    expect(updated.version).toBe(2);
    expect(updated.data.stage).toBe("qualified");

    const timeline = await asAlice(w, () => getTimeline({ type: "deal", id: rec.id }));
    expect(timeline.some((t) => t.summary === "Updated stage")).toBe(true);
  });

  it("enforces the can() gate: a member cannot update another member's record", async () => {
    const rec = await asAlice(w, () =>
      createRecord({ type: "deal", data: { name: "Alice deal", stage: "lead" } }),
    );
    await expect(
      requestContext.run({ principal: w.bob }, () =>
        updateRecord({ type: "deal", id: rec.id, patch: { stage: "won" } }),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("detects stale writes via optimistic concurrency", async () => {
    const rec = await asAlice(w, () =>
      createRecord({ type: "deal", data: { name: "Umbrella", stage: "lead" } }),
    );
    await asAlice(w, () =>
      updateRecord({ type: "deal", id: rec.id, patch: { stage: "qualified" }, baseVersion: 1 }),
    );
    // Second writer still thinks version is 1.
    await expect(
      asAlice(w, () =>
        updateRecord({ type: "deal", id: rec.id, patch: { stage: "won" }, baseVersion: 1 }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("compiles the Filter AST: eq, money gt, and select in", async () => {
    await asAlice(w, async () => {
      await createRecord({ type: "deal", data: { name: "Small", amount: { amount: 1000, currency: "USD" }, stage: "lead" } });
      await createRecord({ type: "deal", data: { name: "Big", amount: { amount: 900000, currency: "USD" }, stage: "qualified" } });
      await createRecord({ type: "deal", data: { name: "Won one", amount: { amount: 50000, currency: "USD" }, stage: "won" } });
    });

    const qualified = await asAlice(w, () =>
      listRecords({ type: "deal", filter: { field: "stage", op: "eq", value: "qualified" } }),
    );
    expect(qualified.records.map((r) => r.data.name)).toEqual(["Big"]);

    const big = await asAlice(w, () =>
      listRecords({ type: "deal", filter: { field: "amount", op: "gt", value: 100000 } }),
    );
    expect(big.records.map((r) => r.data.name)).toEqual(["Big"]);

    const openStages = await asAlice(w, () =>
      listRecords({
        type: "deal",
        filter: { field: "stage", op: "in", value: ["lead", "qualified"] },
        sort: { field: "name", direction: "asc" },
      }),
    );
    expect(openStages.records.map((r) => r.data.name)).toEqual(["Big", "Small"]);
  });

  it("supports the no_activity_within activity operator", async () => {
    // A neglected deal whose last activity is long in the past.
    setClock(new FakeClock("2020-01-01T00:00:00.000Z"));
    const old = await asAlice(w, () =>
      createRecord({ type: "deal", data: { name: "Neglected", stage: "lead" } }),
    );
    // A fresh deal touched just now.
    setClock(systemClock);
    await asAlice(w, () => createRecord({ type: "deal", data: { name: "Fresh", stage: "lead" } }));

    const neglected = await asAlice(w, () =>
      listRecords({
        type: "deal",
        filter: { field: "last_activity_at", op: "no_activity_within", value: { amount: 7, unit: "day" } },
      }),
    );
    expect(neglected.records.map((r) => r.data.name)).toEqual(["Neglected"]);
    expect(neglected.records[0]!.id).toBe(old.id);
  });

  it("runs FTS search and saved views through the shared engine", async () => {
    await asAlice(w, async () => {
      await createRecord({ type: "deal", data: { name: "Northwind Traders", stage: "lead" } });
      await createRecord({ type: "deal", data: { name: "Contoso", stage: "qualified" } });
    });

    const hits = await asAlice(w, () => searchRecords({ query: "Northwind", type: "deal" }));
    expect(hits.map((r) => r.data.name)).toEqual(["Northwind Traders"]);

    const view = await asAlice(w, () =>
      createSavedView({
        recordType: "deal",
        name: "Qualified",
        filter: { field: "stage", op: "eq", value: "qualified" },
        layout: { kind: "table" },
      }),
    );
    const rendered = await asAlice(w, () => renderView(view.id));
    expect(rendered.records.map((r) => r.data.name)).toEqual(["Contoso"]);
  });

  it("archives and reassigns ownership", async () => {
    const rec = await asAlice(w, () =>
      createRecord({ type: "deal", data: { name: "Wayne Ent", stage: "lead" } }),
    );
    const reassigned = await asAlice(w, () =>
      transitionOwner({ type: "deal", id: rec.id, newOwnerId: w.bob.id, baseVersion: 1 }),
    );
    expect(reassigned.ownerId).toBe(w.bob.id);

    // Ownership moved to Bob, so Bob (its owner) is the one who can archive it.
    const archived = await requestContext.run({ principal: w.bob }, () =>
      archiveRecord({ type: "deal", id: rec.id, baseVersion: 2 }),
    );
    expect(archived.archivedAt).not.toBeNull();

    const live = await asAlice(w, () => listRecords({ type: "deal" }));
    expect(live.records.find((r) => r.id === rec.id)).toBeUndefined();
  });

  it("isolates tenants: another org cannot see the first org's records (RLS)", async () => {
    await asAlice(w, () => createRecord({ type: "deal", data: { name: "Secret", stage: "lead" } }));

    const other = await seedWorld("initech");
    const seen = await requestContext.run({ principal: other.alice }, () =>
      listRecords({ type: "deal" }),
    );
    expect(seen.records).toEqual([]);
  });
});

// Keep the type import used for editor clarity.
export type { RecordModel };
