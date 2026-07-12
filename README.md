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

## Status — Phase 0 (records-first)

The **records engine to its P0 scope** plus the foundation it depends on are built and tested — real code on the data path, no stubs. Delivered so far: `@casper/platform` (Drizzle over PGlite/Neon, tenancy context, migration runner, RLS), `@casper/auth` (principals, tenancy entities, `can()`), `@casper/events` (event envelope, transactional outbox, audit log + timeline projections), and `@casper/records` (field registry, compiled-zod validation, the single write path, Filter AST → SQL, saved views, FTS).

Verified by 18 passing tests including the Phase 0 exit criterion — **tenant isolation enforced by Postgres RLS**, not just app code. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the full breakdown and deviations from the plans.

## Getting started

Requires **Node ≥ 22** and **pnpm 9**.

```bash
pnpm install
pnpm test        # runs the suite on in-process PGlite — no DB server needed
pnpm typecheck
pnpm build
```

Tests use PGlite (real Postgres in WASM), so RLS, generated columns, and FTS all behave; the Neon serverless driver is the production swap behind config, with no module changes.

## Tech stack

TypeScript · pnpm + Turborepo · Drizzle ORM · Neon Postgres (PGlite in dev/test) · Vitest · Next.js (App Router) + Tailwind + shadcn/ui · tRPC · Vercel (Fluid Compute, Cron, Workflow DevKit) · Anthropic Claude.
