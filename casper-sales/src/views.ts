import { requestContext } from "@casper/platform";
import {
  createSavedView,
  listSavedViews,
  type Filter,
  type SavedViewModel,
} from "@casper/records";

/**
 * Default sales views (casper-sales plan §Scope), created per workspace at seed time.
 * Every list here is a Filter AST run through the same `listRecords` engine the
 * assistant and automations use — "the assistant's smarts are mostly queries + config".
 */

/** The open pipeline stages (everything that is not Won/Lost). */
export const OPEN_DEAL_STAGES = ["new", "qualified", "proposal", "negotiation"];

const openDealsFilter: Filter = { field: "stage", op: "in", value: OPEN_DEAL_STAGES };

/**
 * A deal is *neglected* when it is open AND any of: no activity for 14 days, its next
 * action date is past due, or it has sat in its current stage for 30+ days. The first
 * two mirror the workflow SLA rules; "next action overdue" lives only here because it
 * is not an SLA *kind* (see pipeline.ts). `older_than {0, day}` compiles to
 * `nextActionDate < now()`; null next-action dates are excluded by the null comparison.
 */
export const NEGLECTED_DEALS_FILTER: Filter = {
  and: [
    openDealsFilter,
    {
      or: [
        { field: "last_activity_at", op: "no_activity_within", value: { amount: 14, unit: "day" } },
        { field: "nextActionDate", op: "older_than", value: { amount: 0, unit: "day" } },
        { field: "stageEnteredAt", op: "older_than", value: { amount: 30, unit: "day" } },
      ],
    },
  ],
};

const DEAL_COLUMNS = ["name", "company", "amount", "stage", "expectedCloseDate", "nextActionDate"];

export interface SeededViews {
  created: SavedViewModel[];
  skipped: string[];
}

/**
 * Create the default views in the current workspace (idempotent — a view whose name
 * already exists for this type is left as-is). Shared views are visible workspace-wide;
 * "My open deals" is personal to the seeding principal (the Filter AST has no
 * "current user" token yet — a future engine nicety — so a per-user filter is baked at
 * creation time).
 */
export async function seedDefaultViews(): Promise<SeededViews> {
  const ctx = requestContext.require();
  const created: SavedViewModel[] = [];
  const skipped: string[] = [];

  const existing = new Map<string, Set<string>>();
  for (const type of ["deal", "company", "contact"]) {
    const views = await listSavedViews(type);
    existing.set(type, new Set(views.map((v) => v.name)));
  }

  async function ensure(input: Parameters<typeof createSavedView>[0]): Promise<void> {
    if (existing.get(input.recordType)?.has(input.name)) {
      skipped.push(input.name);
      return;
    }
    created.push(await createSavedView(input));
  }

  await ensure({
    recordType: "deal",
    name: "Pipeline",
    scope: "shared",
    filter: openDealsFilter,
    layout: { kind: "board", groupByField: "stage" },
    columns: DEAL_COLUMNS,
  });
  await ensure({
    recordType: "deal",
    name: "My open deals",
    scope: "personal",
    filter: { and: [{ field: "owner", op: "eq", value: ctx.principal.id }, openDealsFilter] },
    sort: { field: "nextActionDate", direction: "asc" },
    layout: { kind: "table" },
    columns: DEAL_COLUMNS,
  });
  await ensure({
    recordType: "deal",
    name: "Neglected deals",
    scope: "shared",
    filter: NEGLECTED_DEALS_FILTER,
    sort: { field: "lastActivityAt", direction: "asc" },
    layout: { kind: "table" },
    columns: DEAL_COLUMNS,
  });
  await ensure({
    recordType: "company",
    name: "All companies",
    scope: "shared",
    layout: { kind: "table" },
    columns: ["name", "domain", "industry", "size", "region"],
  });
  await ensure({
    recordType: "contact",
    name: "All contacts",
    scope: "shared",
    layout: { kind: "table" },
    columns: ["name", "email", "phone", "title", "company"],
  });

  return { created, skipped };
}
