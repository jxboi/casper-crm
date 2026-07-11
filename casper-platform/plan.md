# casper-platform — Plan

**Status:** Draft v0.1 | **Layer:** Foundation | **Phases:** 0+ | **Depends on:** — | **Used by:** every module | **Aligned with:** master-plan v0.3 (D-001, D-002, D-011, D-012, D-016, D-019)

## Purpose

The shared kernel. Everything infrastructural that more than one module needs lives here so that business modules contain only business logic. No module may import `pg`, `drizzle-orm` clients, queue libraries, or logging libraries directly — always through platform APIs. This is what keeps the modular monolith modular.

## Scope

**In**
- **Database:** Drizzle client factory over **Neon provisioned via the Vercel Marketplace** (unified billing, `vercel env pull` integration) with `@neondatabase/serverless` pooling for function-friendly connections (D-019); transaction helper (`withTx`), per-module migration registration + central migration runner, RLS session-variable plumbing (`app.org_id`, `app.principal_id`).
- **Tenancy context:** AsyncLocalStorage-based request context carrying `Principal`, `orgId`, `workspaceId`, `correlationId`. Set once at the edge (web server action / api route / job start), readable everywhere. All DB access asserts context is present.
- **Jobs & workflows (D-019):** typed wrapper over **Vercel Workflow DevKit + Vercel Cron** — `defineWorkflow(name, schema, fn)` (durable `"use workflow"` orchestration with `"use step"` units; per-step retry/backoff; `FatalError`/`RetryableError` mapped from the AppError taxonomy), `defineCron(path, schedule, handler)` (composed into `vercel.json` by casper-api, `CRON_SECRET`-verified), `trigger()` via WDK `start()` / `waitUntil`, idempotency-key convention. Definitions live with owning modules; casper-api composes them into the deployable surface. No persistent worker process exists — anything long-running must be a workflow.
- **Config:** zod-validated environment loading; per-env config; secret refs.
- **Crypto:** secret sealing/unsealing (libsodium sealed boxes) for OAuth tokens and API secrets; hashing utilities for API keys.
- **Observability:** structured logging with principal/org/correlation fields auto-attached, sunk to **Vercel Observability / runtime logs + log drains** (D-019; Sentry optional on top); error taxonomy (`AppError` with stable codes: `not_found`, `permission_denied`, `validation_failed`, `conflict`, `budget_exceeded`, …); basic metrics counters.
- **Feature flags:** **Flags SDK** (D-019) — global/platform flags backed by Edge Config; org-scoped targeting via a Postgres-backed adapter (`flags.isEnabled(flag, orgId)`).
- **Rate limiting:** Postgres-based token bucket keyed by org/user/API-key for app-level limits and AI budgets; coarse edge-level request limits via **Vercel WAF** in front (D-019).
- **Blob storage:** adapter interface + **Vercel Blob** implementation (`put/get/sign/delete`, client-upload token flow) — attachments, screenshots, artifacts (D-019).
- **System mail adapter:** transactional email via Resend (invites, notifications, digests). *User-mailbox* email is casper-comms, not here.
- **Test kit:** ephemeral test DB per suite (Neon branch or local Postgres), context/principal factories, fake clock, `@workflow/vitest` harness for workflow integration tests (hooks/sleeps resumable in-process).

**Out**
- HTTP routing and server processes (casper-api), UI (casper-web), any business entities, authN/authZ logic (casper-auth), event semantics (casper-events — though its outbox uses platform DB/jobs).

## Key design points

- **RLS as belt-and-braces (D-002):** the primary guard is application-level scoping through the tenancy context + `can()`; RLS policies on every domain table make cross-tenant reads fail even if application code has a bug. Migration helper auto-generates the standard RLS policy for tables that declare `orgId`.
- **One transaction helper:** `withTx(fn)` provides the transaction used by both business writes and the event outbox (casper-events) so events commit atomically with mutations (D-005).
- **Job idempotency:** every job payload includes an idempotency key; handlers are written to be safely re-runnable (at-least-once delivery).
- **Error taxonomy is API-stable:** web and api map `AppError` codes to HTTP/UI responses uniformly; AI tools map them to structured tool errors.

## Public interface (conceptual)

`getDb()`, `withTx()`, `runMigrations()`, `requestContext.run(ctx, fn)` / `requestContext.get()`, `defineJob()/enqueue()/schedule()`, `config`, `seal()/unseal()`, `hashKey()`, `logger`, `AppError`, `flags`, `rateLimit.check()`, `blobs`, `systemMail.send()`, test-kit helpers.

## Phasing

- **P0:** everything above except blob storage may stub to local disk; flags minimal (env only).
- **P1:** blob storage real (attachments, artifacts); rate limits on AI endpoints.
- **P2:** budget metering primitives for AI (counters with hard caps); metrics export.
- **P3+:** retention jobs (event/audit pruning per org policy — PDPA, D-016).

## Open questions

- Local dev DB: dockerized Postgres vs Neon branches (default: docker for offline dev, Neon branch for CI; preview deployments can pair with Neon preview branches).

## Success criteria

- No business module imports infra libraries directly (lint-enforced).
- Cross-tenant read attempt with mismatched RLS context fails in an automated test (Phase 0 exit criterion).
- A new module can register tables + migrations + jobs without touching platform internals.
