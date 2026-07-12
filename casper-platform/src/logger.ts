import { requestContext } from "./context.js";

/**
 * Structured logging (D-019 — sunk to Vercel Observability in prod). Principal /
 * org / correlation fields are auto-attached from the request context so every
 * line is traceable without callers passing them in.
 */
type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const ctx = requestContext.get();
  const line = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...(ctx
      ? {
          orgId: ctx.orgId,
          workspaceId: ctx.workspaceId,
          principalId: ctx.principal.id,
          principalKind: ctx.principal.kind,
          correlationId: ctx.correlationId,
        }
      : {}),
    ...fields,
  };
  const sink = level === "error" || level === "warn" ? console.error : console.log;
  sink(JSON.stringify(line));
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
