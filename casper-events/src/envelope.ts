import type { Principal } from "@casper/platform";

/**
 * Event envelope — the cross-module contract (master-plan §6, D-005/D-012).
 * `source` + the causation chain let consumers attribute AI vs human work and
 * protect automations from loops.
 *
 * `SubjectRef` is structurally the records `RecordRef` ({ type, id }); events
 * defines its own alias so it need not depend on casper-records.
 */
export interface SubjectRef {
  type: string;
  id: string;
}

export type EventSource = "ui" | "api" | "automation" | "ai" | "system";

export interface DomainEvent<P = unknown> {
  id: string;
  orgId: string;
  workspaceId: string;
  type: string;
  subject: SubjectRef;
  actor: Principal;
  source: EventSource;
  payload: P;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
}

/** What a caller supplies; the emitter fills the rest from context + clock. */
export interface EmitInput<P = unknown> {
  type: string;
  subject: SubjectRef;
  payload: P;
  source?: EventSource;
  causationId?: string;
}

export interface InteractionInput {
  type: string;
  subject?: SubjectRef;
  data?: Record<string, unknown>;
}
