# casper-sales — Plan

**Status:** Draft v0.1 | **Layer:** Product | **Phases:** 1+ | **Depends on:** casper-records, casper-workflow, casper-ai (framework), casper-events | **Used by:** casper-web (product experience), end users | **Aligned with:** master-plan v0.2 (D-013, D-014, D-017, §2 product-first strategy)

## Purpose

The first product: a Sales CRM with an AI operational assistant. This module is **configuration, prompts, and product glue only** — record types, pipeline, views, automations, dashboards, terminology, seed data, and the Sales Follow-up Assistant definition. If anything here requires engine code changes, that's a signal the engine module needs a capability, not that sales logic should leak downward. This module is the proof of the engine/product split that makes product #2 possible later.

## Scope

**In**
- **Record types (versioned seed config, D-013):**
  - **Contact** — name, emails, phones, title, company (relation), owner, source, notes-adjacent fields.
  - **Company** — name, domain (unique), industry, size, region, owner.
  - **Deal** — name, company (relation), contacts (relation, primary flagged), amount (money), currency, stage, expected close date, next action date, source, owner, lost reason (sensitivity: normal; amount flagged `sensitive` → high-risk field edits per D-007).
  - Relations: contact↔company, deal↔company, deal↔contacts. (Task/Note/Attachment come from the engine.)
- **Pipeline workflow (config on casper-workflow):** `New → Qualified → Proposal → Negotiation → Won | Lost`; guards: amount + expected close required to enter Proposal; lost reason required on → Lost; permissions: only Manager+ may re-open Won/Lost.
- **SLA/neglect rules (the assistant's trigger, defined as config):** deal is *neglected* when open AND (no activity ≥ 14 days OR next action date overdue OR stage dwell > stage threshold). Emits `record.neglected` — consumed by assistant digest, views, notifications.
- **Default automations:** deal → Won ⇒ create onboarding kickoff Task (the reference doc's canonical example); deal → Lost ⇒ notify owner's manager (optional, org toggle); new Deal ⇒ assignment rule hook.
- **Default views:** Pipeline (board by stage), My open deals, Neglected deals, Closing this month, All companies/contacts; sensible default columns.
- **Sales Follow-up Assistant (definition on casper-ai):** persona + prompt pack (versioned in this module); scope: deals/contacts/companies/tasks + timelines, amount visible but high-risk to edit; tool subset (the MVP 10); policy matrix defaults — task/field proposals: `batch_review`; transitions: `require_every_time`; email drafts: always artifacts, send (P2) `require_every_time`; core behaviors: find neglected deals (via `record.neglected` + queries), summarize context from timeline, propose next actions (tasks + next-action-date updates + email draft), respect user working style feedback.
- **Daily digest (P2):** morning summary per user — neglected deals, today's tasks, pending approvals — with one-click "have the assistant prepare follow-ups".
- **Dashboards (P2):** pipeline value by stage, win rate, cycle time, activity volume — event/record aggregates (no new analytics infra).
- **Onboarding & seed data (M1-critical, D-017):** the seed script is the dogfood data source — two variants: a **demo dataset** (realistic companies/contacts/deals with history, powers the M1 assistant demo) and a **founder-pipeline template** (skeleton the founder hand-edits into his real pipeline). First-run checklist stays minimal in P1 (seed or start empty, invite team); CSV import joins the checklist in P2 for design partners.
- **Terminology map:** engine-generic terms → sales terms in UI copy (record → deal, etc.) via a lightweight i18n-style layer consumed by casper-web.

**Out**
- Any engine capability (fields/views/workflow/AI mechanics), billing, marketing site, second product content, custom per-customer code (differences are config — reference doc §3, non-negotiable).

## Key design points

- **Config-as-code in-repo:** all definitions live as typed TS/JSON config with a seed/upgrade script (idempotent, versioned). Org-level divergence happens through admin UI + change sets on top of the seeded baseline, never by editing customer-specific code.
- **The assistant's "smarts" are mostly queries + config:** neglect detection is an SLA rule; candidate lists are Filter AST queries; the model's job is judgment + drafting, not data plumbing. Keeps runs cheap and outcomes predictable.
- **Prompt pack ownership here, framework there:** casper-ai defines *how* prompts are versioned/loaded; this module owns the sales persona's content and its eval fixtures (golden scenarios: neglected-deal follow-up, post-meeting update, pipeline hygiene sweep).

## Phasing

- **P1a (dogfood CRM):** types + pipeline + views + neglect rules + Won-automation; seed script (demo + founder variants); terminology.
- **P1b/1c (M1 + hardening):** assistant v1 (follow-up preparation end-to-end on M1 tool subset, then full toolset); onboarding checklist.
- **P2:** daily digest; dashboards; CSV import + dedupe (design-partner gate, D-017); assistant eval fixtures baseline.
- **P3:** feeds the evolution loop with real usage (this module's usage *is* the Phase-3 test bed).
- **P4:** industry template variants (e.g. agency vs SaaS pipeline presets).

## Open questions

- Multi-pipeline support (multiple deal workflows per org) in MVP? (Default: single pipeline P1; engine already supports N — expose in P2 if design partners need it.)
- Default currency handling for orgs (org default + per-deal override — confirm with first users; SGD/USD mix likely given market).

## Success criteria

- Zero engine code changes required to ship this module (the split holds).
- Fresh org → seeded, usable CRM with demo data in < 2 minutes (via seed script; no import required, D-017).
- Assistant demo path works on demo data: "prepare follow-ups for my neglected deals" → plan → proposals (tasks + field updates + 2 email drafts) → selective approve → commit → timeline + audit updated.
- A second product definition could be written by copying this module's shape (checked via a thought-experiment doc at P2 exit, not by building it).
