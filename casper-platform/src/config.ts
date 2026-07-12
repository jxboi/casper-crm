import { z } from "zod";

/**
 * Environment configuration (zod-validated). P0 keeps this minimal; blob/crypto/
 * flags/mail settings land as their features come online (platform plan phasing).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Postgres connection string. When absent, the DB layer uses in-process PGlite. */
  DATABASE_URL: z.string().optional(),
  /** On-disk PGlite data dir; when absent PGlite runs in-memory. */
  PGLITE_DATA: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function config(): Config {
  cached ??= loadConfig();
  return cached;
}
