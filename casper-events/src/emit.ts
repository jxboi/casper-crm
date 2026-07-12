import { AppError, newId, now, requestContext, withTx, type Tx } from "@casper/platform";
import { domainEvents, interactionEvents } from "./schema.js";
import { getEventSchema } from "./registry.js";
import type { DomainEvent, EmitInput, InteractionInput } from "./envelope.js";

/**
 * Append a domain event to the outbox *in the caller's transaction* (D-005), so
 * the event commits atomically with the mutation that produced it. Actor, org,
 * workspace, and correlation come from the request context; the timestamp comes
 * from the platform clock. The row is written undispatched; `dispatchPending()`
 * fans it out after commit.
 */
export async function emit<P>(tx: Tx, input: EmitInput<P>): Promise<DomainEvent<P>> {
  const ctx = requestContext.require();

  const schema = getEventSchema(input.type);
  if (schema) {
    const parsed = schema.safeParse(input.payload);
    if (!parsed.success) {
      throw AppError.validation(`event payload invalid for '${input.type}'`, parsed.error.issues);
    }
  }

  const event: DomainEvent<P> = {
    id: newId(),
    orgId: ctx.orgId,
    workspaceId: ctx.workspaceId ?? ctx.principal.workspaceId ?? "",
    type: input.type,
    subject: input.subject,
    actor: ctx.principal,
    source: input.source ?? sourceForPrincipal(ctx.principal.kind),
    payload: input.payload,
    occurredAt: now().toISOString(),
    correlationId: ctx.correlationId,
    causationId: input.causationId,
  };

  if (!event.workspaceId) {
    throw AppError.invalidState("cannot emit a domain event without a workspace in context");
  }

  await tx.insert(domainEvents).values({
    id: event.id,
    orgId: event.orgId,
    workspaceId: event.workspaceId,
    type: event.type,
    subjectType: event.subject.type,
    subjectId: event.subject.id,
    actorKind: event.actor.kind,
    actorId: event.actor.id,
    source: event.source,
    payload: event.payload as unknown,
    occurredAt: new Date(event.occurredAt),
    correlationId: event.correlationId,
    causationId: event.causationId ?? null,
  });

  return event;
}

function sourceForPrincipal(kind: string): DomainEvent["source"] {
  switch (kind) {
    case "assistant":
      return "ai";
    case "system":
      return "system";
    case "api_key":
      return "api";
    default:
      return "ui";
  }
}

/**
 * Interaction telemetry (feedback loop) — best-effort, its own transaction,
 * never atomic with a mutation. Records emits `export.clicked` here in P1.
 */
export async function emitInteraction(input: InteractionInput): Promise<void> {
  const ctx = requestContext.require();
  await withTx((tx) =>
    tx.insert(interactionEvents).values({
      id: newId(),
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId ?? "",
      type: input.type,
      actorKind: ctx.principal.kind,
      actorId: ctx.principal.id,
      subjectType: input.subject?.type ?? null,
      subjectId: input.subject?.id ?? null,
      data: input.data ?? {},
      occurredAt: now(),
    }),
  );
}
