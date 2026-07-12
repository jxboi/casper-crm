import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "./errors.js";
import { newId } from "./ids.js";
import type { Principal } from "./principal.js";

/**
 * Tenancy context (D-002/D-003). Established once at the edge — a web server
 * action, an api route, or a job/workflow step start — and readable everywhere
 * below without threading it through call signatures. Every tenant-scoped DB
 * access asserts it is present so nothing runs "outside a tenant" by accident.
 */
export interface RequestContext {
  principal: Principal;
  orgId: string;
  workspaceId?: string;
  correlationId: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export interface RunContextInput {
  principal: Principal;
  /** Defaults to the principal's org / workspace. */
  orgId?: string;
  workspaceId?: string;
  correlationId?: string;
}

export const requestContext = {
  run<T>(input: RunContextInput, fn: () => T): T {
    const ctx: RequestContext = {
      principal: input.principal,
      orgId: input.orgId ?? input.principal.orgId,
      workspaceId: input.workspaceId ?? input.principal.workspaceId,
      correlationId: input.correlationId ?? newId(),
    };
    return als.run(ctx, fn);
  },

  /** Current context, or throw — use when a tenant is required. */
  require(): RequestContext {
    const ctx = als.getStore();
    if (!ctx) {
      throw new AppError(
        "invalid_state",
        "No request context: tenant-scoped code must run inside requestContext.run()",
      );
    }
    return ctx;
  },

  /** Current context, or undefined — use when a tenant is optional. */
  get(): RequestContext | undefined {
    return als.getStore();
  },
};
