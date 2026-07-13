import { AsyncLocalStorage } from "node:async_hooks";
import type { EventSource } from "./envelope.js";

/**
 * Ambient emission context (D-026). Lets a caller stamp `causationId` and/or
 * `source` onto every `emit()` inside a dynamic scope *without* threading those
 * fields through every write-path signature (`createRecord`/`updateRecord`/
 * `transition` don't accept them). `emit()` reads this only as a fallback — an
 * explicit `EmitInput.source`/`.causationId` still wins, and when no scope is
 * active behavior is exactly as before (so existing suites are unaffected).
 *
 * Two consumers:
 *  - casper-changesets commit wraps each applied change in
 *    `withEmissionContext({ causationId: changesetId })` so every resulting event
 *    is attributable to the change set (the audit chain the reference docs demand).
 *  - the casper-workflow automation runtime wraps action execution in
 *    `withEmissionContext({ causationId: triggerEventId, source: "automation" })`
 *    so effect events carry a walkable causation chain (loop protection) and are
 *    marked as automation-produced.
 */
export interface EmissionContext {
  causationId?: string;
  source?: EventSource;
}

const als = new AsyncLocalStorage<EmissionContext>();

export function withEmissionContext<T>(ctx: EmissionContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function currentEmission(): EmissionContext | undefined {
  return als.getStore();
}
