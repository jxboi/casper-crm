import { now } from "@casper/platform";
import { createRecord, listRecords, type RecordModel } from "@casper/records";
import { seedDefaultViews, type SeededViews } from "./views.js";

/**
 * Seed runner (casper-sales plan §Onboarding & seed data, D-017) — the dogfood data
 * source, since CSV import is deferred to Phase 2. Two variants:
 *  - `demo`: a realistic dataset (companies, contacts, deals across the pipeline,
 *     including some already neglected) that powers the M1 assistant demo;
 *  - `founder`: just the default views — an empty pipeline the founder fills with his
 *     real deals.
 *
 * Runs inside a `requestContext` (a principal + workspace); the caller establishes it.
 * This is the function `pnpm play sales` will drive once the playground host lands; it
 * is a plain library call so it is testable today. Idempotent: if the workspace already
 * has companies, record creation is skipped (views are ensured either way).
 *
 * All writes go through the records single write path — no direct table access, no
 * engine changes — so seeding produces real audit + timeline history like any user.
 */
export type SeedVariant = "demo" | "founder";

export interface SeedResult {
  variant: SeedVariant;
  companies: RecordModel[];
  contacts: RecordModel[];
  deals: RecordModel[];
  views: SeededViews;
  skipped: boolean;
}

/** Money helper — whole currency units → minor units (D-012). */
function money(units: number, currency = "SGD"): { amount: number; currency: string } {
  return { amount: Math.round(units * 100), currency };
}

/** `YYYY-MM-DD`, `daysFromNow` may be negative (past) for overdue/aged seed data. */
function dateOnly(daysFromNow: number): string {
  const d = new Date(now().getTime() + daysFromNow * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** ISO datetime with offset (for `stageEnteredAt`). */
function dateTime(daysFromNow: number): string {
  return new Date(now().getTime() + daysFromNow * 86_400_000).toISOString();
}

export async function seedSalesData(
  input: { variant?: SeedVariant } = {},
): Promise<SeedResult> {
  const variant = input.variant ?? "demo";

  // Views first (idempotent), so a re-run or a `founder` seed still provisions them.
  const views = await seedDefaultViews();

  const existing = await listRecords({ type: "company", limit: 1 });
  const alreadySeeded = existing.records.length > 0;

  if (variant === "founder" || alreadySeeded) {
    return { variant, companies: [], contacts: [], deals: [], views, skipped: alreadySeeded };
  }

  // --- Companies -------------------------------------------------------------
  const acme = await createRecord({
    type: "company",
    data: { name: "Acme Robotics", domain: "acme.io", industry: "manufacturing", size: "51-200", region: "SG" },
  });
  const globex = await createRecord({
    type: "company",
    data: { name: "Globex SaaS", domain: "globex.com", industry: "saas", size: "11-50", region: "SG" },
  });
  const initech = await createRecord({
    type: "company",
    data: { name: "Initech Financial", domain: "initech.co", industry: "fintech", size: "201-1000", region: "US" },
  });
  const companies = [acme, globex, initech];

  // --- Contacts --------------------------------------------------------------
  const jane = await createRecord({
    type: "contact",
    data: { name: "Jane Tan", email: "jane@acme.io", phone: "+65 8123 4567", title: "Head of Ops", company: acme.id, source: "referral" },
  });
  const raj = await createRecord({
    type: "contact",
    data: { name: "Raj Patel", email: "raj@globex.com", title: "CTO", company: globex.id, source: "inbound" },
  });
  const mei = await createRecord({
    type: "contact",
    data: { name: "Mei Lin", email: "mei@globex.com", title: "Procurement", company: globex.id, source: "inbound" },
  });
  const bob = await createRecord({
    type: "contact",
    data: { name: "Bob Chen", email: "bob@initech.co", title: "VP Finance", company: initech.id, source: "event" },
  });
  const contacts = [jane, raj, mei, bob];

  // --- Deals (across the pipeline; two are already neglected) -----------------
  const deals: RecordModel[] = [];

  // New — fresh, healthy.
  deals.push(
    await createRecord({
      type: "deal",
      data: {
        name: "Acme — robotics rollout",
        company: acme.id,
        contacts: [jane.id],
        primaryContact: jane.id,
        amount: money(60_000),
        stage: "new",
        stageEnteredAt: dateTime(-2),
        expectedCloseDate: dateOnly(45),
        nextActionDate: dateOnly(3),
        source: "referral",
      },
    }),
  );

  // Proposal — healthy, upcoming next action.
  deals.push(
    await createRecord({
      type: "deal",
      data: {
        name: "Globex — platform license",
        company: globex.id,
        contacts: [raj.id, mei.id],
        primaryContact: raj.id,
        amount: money(120_000),
        stage: "proposal",
        stageEnteredAt: dateTime(-6),
        expectedCloseDate: dateOnly(20),
        nextActionDate: dateOnly(2),
        source: "inbound",
      },
    }),
  );

  // Negotiation — NEGLECTED: next action is overdue.
  deals.push(
    await createRecord({
      type: "deal",
      data: {
        name: "Initech — treasury module",
        company: initech.id,
        contacts: [bob.id],
        primaryContact: bob.id,
        amount: money(250_000, "USD"),
        stage: "negotiation",
        stageEnteredAt: dateTime(-10),
        expectedCloseDate: dateOnly(15),
        nextActionDate: dateOnly(-4),
        source: "event",
      },
    }),
  );

  // Qualified — NEGLECTED: stuck in stage well past the 30-day threshold.
  deals.push(
    await createRecord({
      type: "deal",
      data: {
        name: "Acme — spare parts contract",
        company: acme.id,
        contacts: [jane.id],
        primaryContact: jane.id,
        amount: money(35_000),
        stage: "qualified",
        stageEnteredAt: dateTime(-40),
        expectedCloseDate: dateOnly(30),
        nextActionDate: dateOnly(9),
        source: "outbound",
      },
    }),
  );

  // Won — closed, out of the pipeline view.
  deals.push(
    await createRecord({
      type: "deal",
      data: {
        name: "Globex — pilot expansion",
        company: globex.id,
        contacts: [raj.id],
        primaryContact: raj.id,
        amount: money(48_000),
        stage: "won",
        stageEnteredAt: dateTime(-1),
        expectedCloseDate: dateOnly(-1),
        source: "inbound",
      },
    }),
  );

  return { variant, companies, contacts, deals, views, skipped: false };
}
