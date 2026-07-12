import { z, type ZodTypeAny } from "zod";
import { AppError } from "@casper/platform";
import type { FieldDef, RecordTypeDef } from "./field-types.js";

/**
 * Field defs compile to a zod schema, cached per type+version (records plan;
 * D-013). The *same* compiled validator runs on direct writes and on change-set
 * commit re-validation — the single validation path guarantee.
 */
interface Compiled {
  full: z.ZodObject<Record<string, ZodTypeAny>>;
  partial: z.ZodObject<Record<string, ZodTypeAny>>;
}

const cache = new Map<string, Compiled>();

function cacheKey(type: RecordTypeDef): string {
  return `${type.key}:${type.version}`;
}

function moneySchema(): ZodTypeAny {
  return z.object({
    amount: z.number().int(),
    currency: z.string().length(3),
  });
}

function fieldSchema(field: FieldDef): ZodTypeAny {
  let base: ZodTypeAny;
  switch (field.type) {
    case "text":
    case "long_text": {
      let s = z.string();
      if (field.min !== undefined) s = s.min(field.min);
      if (field.max !== undefined) s = s.max(field.max);
      base = s;
      break;
    }
    case "email":
      base = z.string().email();
      break;
    case "url":
      base = z.string().url();
      break;
    case "phone":
      base = z.string().min(1);
      break;
    case "number": {
      let n = z.number();
      if (field.min !== undefined) n = n.min(field.min);
      if (field.max !== undefined) n = n.max(field.max);
      base = n;
      break;
    }
    case "money":
      base = moneySchema();
      break;
    case "date":
      base = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
      break;
    case "datetime":
      base = z.string().datetime({ offset: true });
      break;
    case "checkbox":
      base = z.boolean();
      break;
    case "select": {
      const values = (field.options ?? []).map((o) => o.value);
      base = z.string().refine((v) => values.includes(v), {
        message: `must be one of: ${values.join(", ")}`,
      });
      break;
    }
    case "multi_select": {
      const values = (field.options ?? []).map((o) => o.value);
      base = z.array(
        z.string().refine((v) => values.includes(v), {
          message: `must be one of: ${values.join(", ")}`,
        }),
      );
      break;
    }
    case "user":
      base = z.string().uuid();
      break;
    case "relation":
      base =
        field.relation?.cardinality === "many"
          ? z.array(z.string().uuid())
          : z.string().uuid();
      break;
    case "json":
      base = z.unknown();
      break;
  }

  // Non-required fields may be omitted or explicitly null.
  return field.required ? base : base.nullish();
}

function compile(type: RecordTypeDef): Compiled {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of type.fields) {
    if (field.archived) continue; // archived fields are not writable
    shape[field.key] = fieldSchema(field);
  }
  // `.strict()` rejects unknown keys so typos and stale fields surface as errors.
  const full = z.object(shape).strict();
  const partial = full.partial();
  return { full, partial };
}

function compiledFor(type: RecordTypeDef): Compiled {
  const key = cacheKey(type);
  let c = cache.get(key);
  if (!c) {
    c = compile(type);
    cache.set(key, c);
  }
  return c;
}

export interface ValidateOptions {
  /** Validate only the provided keys (for partial updates). */
  partial?: boolean;
}

export function validateRecordData(
  type: RecordTypeDef,
  data: Record<string, unknown>,
  opts: ValidateOptions = {},
): Record<string, unknown> {
  const schema = opts.partial ? compiledFor(type).partial : compiledFor(type).full;
  const result = schema.safeParse(data);
  if (!result.success) {
    throw AppError.validation(
      `invalid data for '${type.key}'`,
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data as Record<string, unknown>;
}

/** Apply field defaults for keys missing from `data` (used on create). */
export function applyDefaults(
  type: RecordTypeDef,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...data };
  for (const field of type.fields) {
    if (field.archived) continue;
    if (out[field.key] === undefined && field.default !== undefined) {
      out[field.key] = field.default;
    }
  }
  return out;
}

/** Test hook. */
export function resetValidatorCache(): void {
  cache.clear();
}
