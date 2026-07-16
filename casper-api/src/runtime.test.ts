import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  newId,
  requestContext,
  withTx,
  withSystemTx,
  type Principal,
} from "@casper/platform";
import { setupTestDb, resetPlatform } from "@casper/platform/testkit";
import { emit, schema as eventSchema } from "@casper/events";
import { registerRuntimeModules, sweepOutbox } from "./index.js";

afterEach(() => resetPlatform());

describe("casper-api Phase 0 runtime", () => {
  it("sweeper recovers an event left undispatched after commit", async () => {
    registerRuntimeModules();
    await setupTestDb();
    const orgId = newId();
    const workspaceId = newId();
    const principal: Principal = { kind: "system", id: newId(), orgId, workspaceId };
    const eventId = await requestContext.run({ principal }, () =>
      withTx(async (tx) => {
        const event = await emit(tx, {
          type: "runtime.recovery_tested",
          subject: { type: "runtime", id: newId() },
          payload: { recovered: true },
        });
        return event.id;
      }),
    );

    const before = await withSystemTx((tx) =>
      tx.select().from(eventSchema.auditLog).where(eq(eventSchema.auditLog.eventId, eventId)),
    );
    expect(before).toHaveLength(0);

    expect(await sweepOutbox()).toBe(1);
    const after = await withSystemTx((tx) =>
      tx.select().from(eventSchema.auditLog).where(eq(eventSchema.auditLog.eventId, eventId)),
    );
    expect(after).toHaveLength(1);
  });
});
