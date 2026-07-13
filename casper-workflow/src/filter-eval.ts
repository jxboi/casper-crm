import { AppError } from "@casper/platform";
import type { Filter, LeafFilter, Duration } from "@casper/records";

/**
 * Pure, in-memory evaluator for the records Filter AST — the twin of the records
 * `compileFilter` (which targets SQL and so cannot run in a pure context). Used to
 * evaluate transition-guard conditions inside `evaluate()`. It reads nothing but its
 * arguments: the record snapshot and the `now` passed in (never the wall clock),
 * which is what keeps replay/simulation deterministic (D-014).
 *
 * Coverage is the P1a subset of operators; unknown operators throw
 * `validation_failed`, exactly as `compileFilter` rejects them.
 */
export interface FilterRecord {
  id: string;
  ownerId: string;
  data: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastActivityAt: string | null;
}

const UNIT_MS: Record<Duration["unit"], number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  // Approximation (SQL `interval '1 month'` is calendar-aware); avoid month in guards.
  month: 30 * 86_400_000,
};

function durationMs(value: unknown): number {
  const d = value as Duration | undefined;
  if (!d || typeof d.amount !== "number" || !(d.unit in UNIT_MS)) {
    throw AppError.validation("relative-date operator needs { amount, unit }");
  }
  return d.amount * UNIT_MS[d.unit];
}

/** Resolve a field reference to its value, honoring the promoted pseudo-fields. */
function resolveField(rec: FilterRecord, field: string): unknown {
  switch (field) {
    case "id":
      return rec.id;
    case "owner":
    case "owner_id":
      return rec.ownerId;
    case "created_at":
      return rec.createdAt ?? null;
    case "updated_at":
      return rec.updatedAt ?? null;
    case "last_activity_at":
      return rec.lastActivityAt;
    default:
      return rec.data[field] ?? null;
  }
}

/** Normalize a value for comparison: money `{amount}` → its numeric amount. */
function normalize(v: unknown): unknown {
  if (v && typeof v === "object" && "amount" in v) {
    const amt = (v as { amount: unknown }).amount;
    if (typeof amt === "number") return amt;
  }
  return v;
}

function toNumber(v: unknown): number {
  const n = normalize(v);
  return typeof n === "number" ? n : Number(n);
}

function toTime(v: unknown): number {
  return new Date(String(v)).getTime();
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function evalLeaf(leaf: LeafFilter, rec: FilterRecord, now: Date): boolean {
  // Activity operator is always on last_activity_at.
  if (leaf.op === "no_activity_within") {
    if (rec.lastActivityAt === null) return true;
    return toTime(rec.lastActivityAt) < now.getTime() - durationMs(leaf.value);
  }

  const field = resolveField(rec, leaf.field);

  switch (leaf.op) {
    case "eq":
      return normalize(field) === normalize(leaf.value);
    case "neq":
      return normalize(field) !== normalize(leaf.value);
    case "gt":
      return toNumber(field) > toNumber(leaf.value);
    case "gte":
      return toNumber(field) >= toNumber(leaf.value);
    case "lt":
      return toNumber(field) < toNumber(leaf.value);
    case "lte":
      return toNumber(field) <= toNumber(leaf.value);
    case "in": {
      const arr = Array.isArray(leaf.value) ? leaf.value : [];
      return arr.map(normalize).includes(normalize(field));
    }
    case "contains":
      if (Array.isArray(field)) return field.map(String).includes(String(leaf.value));
      return String(field ?? "").toLowerCase().includes(String(leaf.value).toLowerCase());
    case "is_empty":
      return isEmpty(field);
    case "is_not_empty":
      return !isEmpty(field);
    case "within_last":
      return toTime(field) >= now.getTime() - durationMs(leaf.value);
    case "older_than":
      return toTime(field) < now.getTime() - durationMs(leaf.value);
    default:
      throw AppError.validation(`unsupported operator '${leaf.op as string}'`);
  }
}

export function evaluateFilter(filter: Filter, rec: FilterRecord, now: Date): boolean {
  if ("and" in filter) return filter.and.every((f) => evaluateFilter(f, rec, now));
  if ("or" in filter) return filter.or.some((f) => evaluateFilter(f, rec, now));
  if ("not" in filter) return !evaluateFilter(filter.not, rec, now);
  return evalLeaf(filter, rec, now);
}
