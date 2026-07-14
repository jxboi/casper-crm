"use server";

import { isAppError } from "@casper/platform";
import { createRecord, getRecord, listRecords, updateRecord } from "@casper/records";
import { getTimeline } from "@casper/events";
import { getActiveVersion, transition } from "@casper/workflow";
import type { Company, Contact, Deal, Task, TimelineEvent, User } from "@/lib/types";
import { withEngine } from "./context";
import {
  toWebCompany,
  toWebContact,
  toWebDeal,
  toWebTask,
  toWebTimelineEvent,
} from "./map";

/**
 * The web ↔ engine data layer (D-018). These Server Functions are the BFF: each opens
 * the dev principal's tenant context and calls the module APIs (query engine + the
 * single write path + the workflow `transition`), returning the web view types.
 *
 * Note (deviation from D-018): the committed layer is tRPC. This first slice uses Next
 * Server Functions instead — native to the App Router, zero extra deps, and lower blast
 * radius in this non-standard Next 16. The typed tRPC client earns its place with the
 * AI run streams (P1b); this transport is swappable without touching the UI.
 */

export interface PipelineData {
  deals: Deal[];
  companies: Company[];
  users: User[];
}

export async function loadPipeline(): Promise<PipelineData> {
  return withEngine(async (engine) => {
    const version = getActiveVersion("deal") ?? 1;
    const [deals, companies] = await Promise.all([
      listRecords({ type: "deal", limit: 200 }),
      listRecords({ type: "company", limit: 200 }),
    ]);
    // Single dev user until login lands; enough to resolve owner avatars on the board.
    const users: User[] = [
      { id: engine.principal.id, name: engine.userName, initials: "AD", role: "manager" },
    ];
    return {
      deals: deals.records.map((r) => toWebDeal(r, version)),
      companies: companies.records.map(toWebCompany),
      users,
    };
  });
}

export type MoveResult =
  | { ok: true; deals: Deal[] }
  | { ok: false; issues: string[] };

/**
 * Move a deal to a new stage through the real workflow engine — pure guard eval →
 * `can()` → the records write path → `stage_changed` → automations. Marking a deal Lost
 * first writes the required `lostReason` (the pipeline guard enforces its presence), then
 * transitions. Guard/permission failures come back as human-readable issues.
 */
export async function moveDealStage(
  dealId: string,
  toStage: string,
  opts?: { lostReason?: string },
): Promise<MoveResult> {
  try {
    const deals = await withEngine(async (engine) => {
      if (toStage === "lost" && opts?.lostReason) {
        await updateRecord({ type: "deal", id: dealId, patch: { lostReason: opts.lostReason } });
      }
      await transition({ type: "deal", id: dealId, toStage });
      const version = getActiveVersion("deal") ?? 1;
      const list = await listRecords({ type: "deal", limit: 200 });
      return list.records.map((r) => toWebDeal(r, version));
    });
    return { ok: true, deals };
  } catch (e) {
    return { ok: false, issues: [errorMessage(e)] };
  }
}

// ---- deal detail ------------------------------------------------------------

export interface DealDetail {
  deal: Deal;
  company: Company | null;
  owner: User | null;
  contacts: Contact[];
  tasks: Task[];
  timeline: TimelineEvent[];
}

export type DetailResult =
  | { ok: true; detail: DealDetail }
  | { ok: false; issues: string[] };

/** Assemble a deal + its company, contacts, tasks, and timeline in one pass. */
async function loadDetail(userName: string, id: string): Promise<DealDetail | null> {
  const version = getActiveVersion("deal") ?? 1;
  const rec = await getRecord("deal", id);
  if (!rec) return null;
  const deal = toWebDeal(rec, version);

  const companyRec = deal.companyId ? await getRecord("company", deal.companyId) : null;

  const contacts: Contact[] = [];
  for (const cid of deal.contactIds) {
    const c = await getRecord("contact", cid);
    if (c) contacts.push(toWebContact(c));
  }

  const taskList = await listRecords({ type: "task", limit: 200 });
  const tasks = taskList.records
    .filter((t) => (t.data.relatedTo as { id?: string } | undefined)?.id === id)
    .map(toWebTask);

  const timeline = (await getTimeline({ type: "deal", id })).map((e) =>
    toWebTimelineEvent(e, userName),
  );

  // Single dev user until login lands, so ownership resolves to the dev principal.
  const owner: User = { id: rec.ownerId, name: userName, initials: "AD", role: "manager" };

  return { deal, company: companyRec ? toWebCompany(companyRec) : null, owner, contacts, tasks, timeline };
}

export async function getDealDetail(id: string): Promise<DealDetail | null> {
  return withEngine((engine) => loadDetail(engine.userName, id));
}

/** Inline field edit (next-action / expected-close / source) → records write path. */
export async function updateDealField(
  dealId: string,
  fieldKey: "nextActionDate" | "expectedCloseDate" | "source",
  value: string,
): Promise<DetailResult> {
  return mutateThenReload(dealId, async () => {
    await updateRecord({ type: "deal", id: dealId, patch: { [fieldKey]: value } });
  });
}

export async function addDealTask(
  dealId: string,
  title: string,
  dueDate: string,
): Promise<DetailResult> {
  return mutateThenReload(dealId, async () => {
    await createRecord({
      type: "task",
      data: { title, due: dueDate, status: "open", source: "manual", relatedTo: { type: "deal", id: dealId } },
    });
  });
}

export async function toggleDealTask(
  dealId: string,
  taskId: string,
  done: boolean,
): Promise<DetailResult> {
  return mutateThenReload(dealId, async () => {
    await updateRecord({ type: "task", id: taskId, patch: { status: done ? "done" : "open" } });
  });
}

async function mutateThenReload(dealId: string, mutate: () => Promise<void>): Promise<DetailResult> {
  try {
    const detail = await withEngine(async (engine) => {
      await mutate();
      return loadDetail(engine.userName, dealId);
    });
    if (!detail) return { ok: false, issues: ["Deal not found"] };
    return { ok: true, detail };
  } catch (e) {
    return { ok: false, issues: [errorMessage(e)] };
  }
}

function errorMessage(e: unknown): string {
  return isAppError(e) ? e.message : e instanceof Error ? e.message : String(e);
}
