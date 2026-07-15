import type { RecordModel } from "@casper/records";
import type { TimelineEntry } from "@casper/events";
import type {
  ChangePreview,
  ChangeSetModel,
  ChangeSetPreview,
  ChangeModel,
} from "@casper/changesets";
import type { Change, ChangeSet, Company, Contact, Deal, StageKey, Task, TimelineEvent } from "@/lib/types";

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

/* ---- change sets (approval flow) -------------------------------------------
   Translate the engine's generic, ops-as-data change set + its preview (before/
   after per change) into the deal-centric web view types the DiffViewer renders.
   Only the follow-up producer's ops occur in practice — a `create` task record
   and an `update` to a deal field — so the mapper is shaped around those; other
   ops degrade to a plain summary row rather than crashing. The web payload is now
   display-only: commit applies the engine change set itself, not this payload. */

const CS_STATUS: Record<ChangeSetModel["status"], ChangeSet["status"]> = {
  draft: "in_review",
  in_review: "in_review",
  approved: "approved",
  committing: "committed",
  committed: "committed",
  rejected: "rejected",
  rolled_back: "rejected",
};

const FIELD_LABEL: Record<string, string> = {
  nextActionDate: "next action date",
  expectedCloseDate: "expected close date",
};

function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function toWebChangeSet(
  cs: ChangeSetModel,
  preview: ChangeSetPreview,
  dealName: (id: string) => string,
): ChangeSet {
  const status = CS_STATUS[cs.status];
  // For committed sets the live-computed before/after is post-commit (before ==
  // after), so it is suppressed — we show the resulting value only.
  const committed = status === "committed";
  const previews = new Map(preview.changes.map((p) => [p.changeId, p]));
  return {
    id: cs.id,
    title: cs.title,
    intent: cs.intent ?? "",
    authorName: cs.origin === "ai_run" || cs.origin === "feedback_proposal" ? "Sales Assistant" : "You",
    origin: cs.origin === "ai_run" ? "ai_run" : "manual",
    status,
    createdAt: cs.createdAt,
    changes: cs.changes.map((c) => toWebChange(c, previews.get(c.id), dealName, committed)),
  };
}

function toWebChange(
  c: ChangeModel,
  p: ChangePreview | undefined,
  dealName: (id: string) => string,
  committed: boolean,
): Change {
  const t = c.target;
  const common = { id: c.id, risk: c.risk, approval: c.approval };

  // create task → "create task" row (the deal it belongs to is the related record).
  if (c.op === "create" && t.kind === "record" && t.type === "task") {
    const payload = (c.payload ?? {}) as { title?: string; due?: string; relatedTo?: { id?: string } };
    const dealId = payload.relatedTo?.id ?? "";
    return {
      ...common,
      op: "create_task",
      dealId,
      dealName: dealName(dealId),
      summary: `Task: “${payload.title ?? "Follow up"}”${payload.due ? ` · due ${payload.due}` : ""}`,
      payload: { taskTitle: payload.title, dueDate: payload.due },
    };
  }

  // update deal field → "update field" row with before/after from the preview.
  if (c.op === "update" && t.kind === "record" && t.type === "deal") {
    const patch = (c.payload ?? {}) as Record<string, unknown>;
    const fieldKey = Object.keys(patch)[0] ?? "";
    const before = (p?.before as Record<string, unknown> | null | undefined)?.[fieldKey];
    const after = (p?.after as Record<string, unknown> | null | undefined)?.[fieldKey] ?? patch[fieldKey];
    const knownField = fieldKey === "nextActionDate" || fieldKey === "expectedCloseDate";
    return {
      ...common,
      op: "update_field",
      dealId: t.id ?? "",
      dealName: dealName(t.id ?? ""),
      summary: FIELD_LABEL[fieldKey] ?? fieldKey,
      before: committed ? undefined : displayValue(before),
      after: displayValue(after),
      payload: knownField ? { fieldKey, value: displayValue(patch[fieldKey]) } : {},
    };
  }

  // Any other op (delete / transition / config_publish) — not produced by the wired
  // follow-up run; render a plain summary so the row is never blank.
  const label = t.kind === "record" ? (t.id ? dealName(t.id) : t.type) : t.configType;
  return {
    ...common,
    op: "update_field",
    dealId: t.kind === "record" ? (t.id ?? "") : "",
    dealName: label,
    summary: `${c.op}${p ? ` → ${displayValue(p.after)}` : ""}`,
    payload: {},
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
