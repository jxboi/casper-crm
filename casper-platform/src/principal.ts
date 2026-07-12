/**
 * Principal — who is acting (master-plan §6, D-004).
 *
 * Refinement note: the master plan attributes the Principal *type* to casper-auth,
 * but the tenancy context (which lives in platform, the root of the dependency
 * graph) has to carry it. Defining the plain data shape here — and having auth own
 * all the *logic* (creation, `can()`, assistant capping) — resolves the import
 * direction without a cycle. auth re-exports this type so consumers still read it
 * as "auth's contract".
 */
export type PrincipalKind = "user" | "assistant" | "api_key" | "system";

export interface Principal {
  kind: PrincipalKind;
  /** uuid of the user / assistant / api key; a stable sentinel for `system`. */
  id: string;
  orgId: string;
  workspaceId?: string;
}

export const SYSTEM_PRINCIPAL_ID = "00000000-0000-0000-0000-000000000000";

/** The principal used by migrations, seeds, and internal jobs — bypasses RLS. */
export function systemPrincipal(orgId: string, workspaceId?: string): Principal {
  return { kind: "system", id: SYSTEM_PRINCIPAL_ID, orgId, workspaceId };
}

export function isSystem(p: Principal): boolean {
  return p.kind === "system";
}
