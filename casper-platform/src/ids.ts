import { uuidv7 } from "uuidv7";

/**
 * ID convention (D-012): all entity IDs are UUIDv7 — time-ordered, so they sort
 * chronologically and make good primary keys / cursors.
 */
export function newId(): string {
  return uuidv7();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
