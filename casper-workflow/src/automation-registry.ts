import { parseAutomationDefinition, type AutomationDefinition } from "./automation-definition.js";

/**
 * In-memory automation registry — mirrors the workflow/record registries. P1b keeps
 * automations code-/test-seeded via `defineAutomation`; persisted
 * `automation_definitions` versions are a fast-follow. Trigger matching uses the same
 * exact / `prefix.*` / `*` semantics as the events consumer registry.
 */
const automations = new Map<string, AutomationDefinition>();

export function defineAutomation(raw: AutomationDefinition | unknown): AutomationDefinition {
  const def = parseAutomationDefinition(raw);
  automations.set(def.id, def);
  return def;
}

export function getAutomation(id: string): AutomationDefinition | undefined {
  return automations.get(id);
}

function triggerMatches(pattern: string, eventType: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return eventType.startsWith(pattern.slice(0, -1));
  return pattern === eventType;
}

/** Enabled automations whose trigger matches an event type, in deterministic id order. */
export function listAutomationsForEvent(eventType: string): AutomationDefinition[] {
  return [...automations.values()]
    .filter((a) => a.enabled && triggerMatches(a.trigger, eventType))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function listAutomations(): AutomationDefinition[] {
  return [...automations.values()];
}

/** Test hook. */
export function resetAutomationRegistry(): void {
  automations.clear();
}
