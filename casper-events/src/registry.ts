import type { ZodType } from "zod";
import type { DomainEvent } from "./envelope.js";
import type { Tx } from "@casper/platform";

/**
 * Two registries (events plan):
 *  - event *type* registry: zod payload schema per type, so emitting an
 *    unregistered/invalid event fails in dev (keeps the stream well-typed);
 *  - *consumer* registry: `on(pattern, handler)` used by projectors, automations,
 *    and denormalizers. A consumer can be added without touching emitter code.
 *
 * Patterns match like actions: exact, `prefix.*`, or `*`.
 */
const typeSchemas = new Map<string, ZodType>();

export function registerEventTypes(schemas: Record<string, ZodType>): void {
  for (const [type, schema] of Object.entries(schemas)) {
    typeSchemas.set(type, schema);
  }
}

export function getEventSchema(type: string): ZodType | undefined {
  return typeSchemas.get(type);
}

export type Consumer = (event: DomainEvent, tx: Tx) => Promise<void>;

interface Registration {
  pattern: string;
  handler: Consumer;
  name?: string;
}

const consumers: Registration[] = [];

function patternMatches(pattern: string, type: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

/**
 * Register a consumer. A `name` makes registration idempotent — re-registering
 * the same name replaces the prior handler (so test resets / hot reload don't
 * accumulate duplicates).
 */
export function on(pattern: string, handler: Consumer, name?: string): void {
  if (name) {
    const existing = consumers.findIndex((c) => c.name === name);
    if (existing >= 0) {
      consumers[existing] = { pattern, handler, name };
      return;
    }
  }
  consumers.push({ pattern, handler, name });
}

export function consumersFor(type: string): Consumer[] {
  return consumers.filter((c) => patternMatches(c.pattern, type)).map((c) => c.handler);
}

/** Test hook: drop non-built-in consumers. */
export function resetConsumers(keepNames: string[] = []): void {
  const keep = new Set(keepNames);
  for (let i = consumers.length - 1; i >= 0; i--) {
    const c = consumers[i];
    if (!c || (c.name && keep.has(c.name))) continue;
    if (!c.name) consumers.splice(i, 1);
  }
}
