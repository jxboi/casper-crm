import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, registerMigrations, resetMigrations } from "./index.js";
import { requestContext, withTx, withSystemTx } from "./index.js";
import { systemPrincipal, newId } from "./index.js";
import { tenantRlsSql } from "./index.js";
import { setupTestDb, resetPlatform } from "./testkit/index.js";

// Proves the platform substrate: migrations apply, withTx sets tenant session
// vars, and RLS actually isolates tenants under PGlite.
describe("platform substrate", () => {
  afterEach(() => resetPlatform());

  it("applies migrations and enforces tenant RLS", async () => {
    resetMigrations();
    registerMigrations([
      {
        module: "smoke",
        version: 1,
        name: "widgets",
        sql: `
          CREATE TABLE widgets (
            id uuid PRIMARY KEY,
            org_id uuid NOT NULL,
            label text NOT NULL
          );
          ${tenantRlsSql("widgets")}
        `,
      },
    ]);
    await setupTestDb();

    const orgA = newId();
    const orgB = newId();

    // System path (bypass) seeds rows for both orgs.
    await requestContext.run({ principal: systemPrincipal(orgA) }, async () => {
      await withSystemTx(async (tx) => {
        await tx.execute(
          sql`INSERT INTO widgets (id, org_id, label) VALUES (${newId()}, ${orgA}, 'a')`,
        );
        await tx.execute(
          sql`INSERT INTO widgets (id, org_id, label) VALUES (${newId()}, ${orgB}, 'b')`,
        );
      });
    });

    // Org A, scoped read, sees only its own row.
    const seen = await requestContext.run(
      { principal: { kind: "user", id: newId(), orgId: orgA } },
      async () =>
        withTx(async (tx) => {
          const r = await tx.execute<{ label: string }>(sql`SELECT label FROM widgets`);
          return r.rows.map((x) => x.label);
        }),
    );
    expect(seen).toEqual(["a"]);

    // Sanity: bypass sees both.
    const all = await requestContext.run(
      { principal: systemPrincipal(orgA) },
      async () =>
        withTx(async (tx) => {
          const r = await tx.execute<{ label: string }>(sql`SELECT label FROM widgets ORDER BY label`);
          return r.rows.map((x) => x.label);
        }),
    );
    expect(all).toEqual(["a", "b"]);

    void getDb;
  });
});
