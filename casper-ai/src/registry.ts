import { AppError } from "@casper/platform";
import type { AssistantDef } from "./types.js";

/**
 * In-memory assistant registry. Assistant definitions are data seeded by product
 * modules (casper-sales registers the Sales Follow-up Assistant), mirroring the
 * records type registry and workflow config: a module-level singleton populated at
 * bootstrap, re-populated per module graph (D-019 — Next bundles route handlers,
 * server actions, and RSC into separate graphs; each must repopulate).
 *
 * The linked assistant *principal* is a real auth principal provisioned at seed
 * time; only the definition lives here.
 */
const assistants = new Map<string, AssistantDef>();

/** Register (or replace) an assistant definition. Idempotent — safe to call per graph. */
export function registerAssistant(def: AssistantDef): void {
  assistants.set(def.key, def);
}

export function getAssistant(key: string): AssistantDef {
  const def = assistants.get(key);
  if (!def) throw AppError.notFound(`assistant '${key}' is not registered`);
  return def;
}

export function tryGetAssistant(key: string): AssistantDef | undefined {
  return assistants.get(key);
}

export function listAssistants(): AssistantDef[] {
  return [...assistants.values()];
}

/** Test hook — clear the registry between suites. */
export function resetAssistantRegistry(): void {
  assistants.clear();
}
