# Casper CRM

An **AI-native CRM** that behaves like a governed operating environment for human and AI work — not a CRM with a chatbot bolted on.

> *"The CRM that evolves with the way your team actually works."*

Two capabilities, one platform:

1. **Operational assistance** — every user has a permissioned AI colleague that prepares real work (follow-ups, updates, drafts) which humans review and commit.
2. **Workflow evolution** — the product detects friction, workarounds, and feedback, and turns them into safe, testable, measurable workflow changes.

## Architecture

A **modular monolith**: one TypeScript monorepo (pnpm workspaces + Turborepo), modules as workspace packages, deployed as a **single Vercel project** over one Neon Postgres database. The engine/product boundary is drawn from day one — engine modules carry zero sales-specific logic; product modules are configuration and glue.

Three architectural bets differentiate the product:

- **Change sets as the universal mutation primitive** — AI work and admin workflow changes both flow through draft → preview → approve → commit → rollback. AI mutation tools can *only* write into change sets, so "zero unapproved mutations" holds by construction.
- **Unified principal model** — `Principal = user | assistant | api_key | system`. AI assistants are first-class principals in the *same* permission system as humans, enforced by the platform via `can(principal, action, resource, ctx)` — never inferred by the model.
- **Event backbone** — every mutation and meaningful interaction becomes a typed event (transactional outbox); audit log, record timeline, automations, and the feedback loop are all consumers.

See [master-plan.md](master-plan.md) — the source of truth for cross-module decisions.

## Modules

| Module | Layer | Purpose | Phase |
|---|---|---|---|
| [casper-platform](casper-platform/plan.md) | Foundation | DB, migrations, jobs, config, crypto, flags, observability | 0 |
| [casper-auth](casper-auth/plan.md) | Foundation | Identity, orgs/workspaces/teams, roles, principals, `can()` | 0 |
| [casper-events](casper-events/plan.md) | Foundation | Domain + interaction events, audit log, timeline, notifications | 0 |
| [casper-records](casper-records/plan.md) | Engine | Record types, fields, relations, validation, views/filters/search | 0 |
| [casper-workflow](casper-workflow/plan.md) | Engine | Stage models, transitions, SLA rules, automations, simulation | 1 |
| [casper-changesets](casper-changesets/plan.md) | Engine | Draft ops, diff, validate, approve, commit, rollback | 1 |
| [casper-comms](casper-comms/plan.md) | Engine | Email: drafts, OAuth send, ingestion, calendar | 1 |
| [casper-ai](casper-ai/plan.md) | AI | Assistant registry, run engine, tool framework, risk/approval policies | 1 |
| [casper-feedback](casper-feedback/plan.md) | AI | Feedback capture, signal detection, change proposals, outcomes | 1/3 |
| [casper-sales](casper-sales/plan.md) | Product | Sales CRM definition: types, pipeline, views, assistant, seed data | 1 |
| [casper-web](casper-web/plan.md) | Application | Next.js app: CRM UI, AI surfaces, approvals inbox, admin | 0 |
| [casper-api](casper-api/plan.md) | Application | Server runtime: job workers, AI run executor, SSE, cron, public API | 0 |

Modules interact only through their exported public API — no reaching into another module's tables or internals.

## Status — a working dogfood slice

Real code on the data path, no stubs, **60 passing tests** (`npx vitest run`). What's built:

- **Foundation + engine (P0/P1):** `@casper/platform` (Drizzle over PGlite/Neon, tenancy context, migration runner, RLS), `@casper/auth` (principals, tenancy entities, `can()`), `@casper/events` (event envelope, transactional outbox, audit log + timeline, comments + in-app notifications), `@casper/records` (field registry, compiled-zod validation, the single write path, Filter AST → SQL, saved views, FTS), `@casper/workflow` (pure `evaluate()` stage machine, guarded transitions, SLA/neglect scans, the automation engine), `@casper/changesets` (draft → risk → approve → commit through module APIs, config publishing).
- **Product (P1a):** `@casper/sales` — the Sales CRM as **configuration only** (Contact/Company/Deal types, the pipeline + neglect rules, default automations + views, an idempotent seed runner). Zero engine changes: proof of the engine/product split.
- **Application:** `casper-web` — the **Pipeline board, deal detail, and the Deals/Companies/Contacts list views run on the real engine**, executed in-process (PGlite) behind a Server-Functions BFF (D-018). Drag/click a deal and transitions flow through the pure workflow guards → `can()` → the records write path → events → the timeline. The AI dock, feedback widget, and change-set approvals are still on a mock store (next increments); login is deferred, so the app runs as a single dev principal.

Includes the Phase 0 exit criterion — **tenant isolation enforced by Postgres RLS**, not just app code. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the full breakdown and deviations from the plans.

## Getting started

Requires **Node ≥ 22** and **pnpm 9**.

```bash
pnpm install
npx vitest run   # the full suite on in-process PGlite — no DB server needed
pnpm typecheck
```

> **Note on the harness:** `pnpm test` currently reports "no test files" per-package (a known monorepo vitest-config quirk, see IMPLEMENTATION.md); run `npx vitest run` from the repo root.

Run the web app (dogfood slice, seeded demo data):

```bash
cd casper-web && pnpm dev   # http://localhost:3000  (Next.js on webpack — see below)
```

The whole modular monolith runs **in-process inside the Next server** on PGlite (real Postgres in WASM), so RLS, generated columns, and FTS all behave; the Neon serverless driver is the production swap behind config. The web app runs `next dev --webpack` (not Turbopack) because the engine packages use `bundler`-resolution `.js` specifiers that need webpack's `extensionAlias` — see IMPLEMENTATION.md ("casper-web").

## Tech stack

TypeScript · pnpm + Turborepo · Drizzle ORM · Neon Postgres (PGlite in dev/test) · Vitest · Next.js (App Router) + Tailwind + shadcn/ui · tRPC · Vercel (Fluid Compute, Cron, Workflow DevKit) · Anthropic Claude.
