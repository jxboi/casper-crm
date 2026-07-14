import type { RecordModel } from "@casper/records";
import type { TimelineEntry } from "@casper/events";
import type { Company, Contact, Deal, StageKey, Task, TimelineEvent } from "@/lib/types";

/**
 * Map engine `RecordModel`s (generic typed records) onto the web app's view types.
 * The web types predate the wiring (they were the mock-store shapes); keeping this
 * translation in one place means the UI is untouched by the switch to real data.
 */

type Money = { amount: number; currency: string } | null | undefined;

export function toWebDeal(rec: RecordModel, workflowVersion: number): Deal {
  const d = rec.data;
  const amount = d.amount as Money;
  return {
    id: rec.id,
    name: String(d.name ?? ""),
    companyId: (d.company as string) ?? "",
    contactIds: (d.contacts as string[]) ?? [],
    stage: (d.stage as StageKey) ?? "new",
    workflowVersion,
    amount: amount?.amount ?? null,
    currency: (amount?.currency as "SGD" | "USD") ?? "SGD",
    expectedCloseDate: (d.expectedCloseDate as string) ?? null,
    nextActionDate: (d.nextActionDate as string) ?? null,
    source: (d.source as string) ?? "",
    ownerId: rec.ownerId,
    lostReason: (d.lostReason as string) ?? null,
    lastActivityAt: rec.lastActivityAt ?? rec.createdAt,
    stageEnteredAt: (d.stageEnteredAt as string) ?? rec.createdAt,
  };
}

export function toWebCompany(rec: RecordModel): Company {
  const d = rec.data;
  return {
    id: rec.id,
    name: String(d.name ?? ""),
    domain: (d.domain as string) ?? "",
    industry: (d.industry as string) ?? "",
    size: (d.size as string) ?? "",
    region: (d.region as string) ?? "",
  };
}

export function toWebContact(rec: RecordModel): Contact {
  const d = rec.data;
  return {
    id: rec.id,
    name: String(d.name ?? ""),
    title: (d.title as string) ?? "",
    email: (d.email as string) ?? "",
    companyId: (d.company as string) ?? "",
  };
}

export function toWebTask(rec: RecordModel): Task {
  const d = rec.data;
  const related = d.relatedTo as { type?: string; id?: string } | undefined;
  const origin = (d.source as string) ?? "manual";
  return {
    id: rec.id,
    title: String(d.title ?? ""),
    dealId: related?.id ?? null,
    assigneeId: (d.assignee as string) ?? rec.ownerId,
    dueDate: (d.due as string) ?? "",
    done: d.status === "done",
    origin: (origin === "automation" || origin === "ai" ? origin : "manual") as Task["origin"],
  };
}

/**
 * Map a projected timeline entry to the web event shape. The projection stores an
 * `actorKind` (user/system) rather than the audit `source`, so we approximate the UI
 * source from it — enough to tint the icon; the human summary carries the real detail.
 */
export function toWebTimelineEvent(entry: TimelineEntry, actorName: string): TimelineEvent {
  const system = entry.actorKind === "system";
  return {
    id: entry.eventId,
    dealId: entry.recordId,
    type: entry.kind,
    summary: entry.summary,
    actorName: system ? "System" : actorName,
    source: system ? "system" : "ui",
    at: entry.occurredAt,
  };
}
