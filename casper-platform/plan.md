# casper-platform — Plan

**Status:** Draft v0.1 | **Layer:** Foundation | **Phases:** 0+ | **Depends on:** — | **Used by:** every module | **Aligned with:** master-plan v0.2 (D-001, D-002, D-011, D-012, D-015, D-016)

## Purpose

The shared kernel. Everything infrastructural that more than one module needs lives here so that business modules contain only business logic. No module may import `pg`, `drizzle-orm` clients, queue libraries, or logging libraries directly — always through platform APIs. This is what keeps the modular monolith modular.

## Scope

**In**
- **Database:** Drizzle client factory, connection pooling, transaction helper (`withTx`), per-module migration registration + central migration runner, RLS session-variable plumbing (`app.org_id`, `app.principal_id`).
- **Tenancy context:** AsyncLocalStorage-based request context carrying `Principal`, `orgId`, `workspaceId`, `correlationId`. Set once at the edge (web server action / api route / job start), readable everywhere. All DB access asserts context is present.
- **Jobs:** typed pg-boss wrapper — `defineJob(name, schema, handler)`, `enqueue`, cron registration, retry/backoff policies, idempotency-key convention, dead-letter handling. (Workers *run* in casper-api; definitions live with owning modules.)
- **Config:** zod-validated environment loading; per-env config; secret refs.
- **Crypto:** secret sealing/unsealing (libsodium sealed boxes) for OAuth tokens and API secrets; hashing utilities for API keys.
- **Observability:** structured logging (pino) with principal/org/correlation fields auto-attached; error taxonomy (`AppError` with stable codes: `not_found`, `permission_denied`, `validation_failed`, `conflict`, `budget_exceeded`, …); Sentry (or similar) wiring; basic metrics counters.
- **Feature flags:** simple DB-backed flags with env override, org-scoped targeting (`flags.isEnabled(flag, orgId)`).
- **Rate limiting:** Postgres-based token bucket keyed by org/user/API-key (fine at MVP traffic).
- **Blob storage:** adapter interface + R2/Vercel-Blob implementation (`put/get/sign/delete`), used for attachments, screenshots, artifacts.
- **System mail adapter:** transactional email via Resend (invites, notifications, digests). *User-mailbox* email is casper-comms, not here.
- **Test kit:** ephemeral test DB per suite (Neon branch or local Postgres), context/principal factories, fake clock.

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

- Q-2 (master): Railway vs Fly for the server runtime — affects only deploy scripts here.
- Local dev DB: dockerized Postgres vs Neon branches (default: docker for offline dev, Neon branch for CI).

## Success criteria

- No business module imports infra libraries directly (lint-enforced).
- Cross-tenant read attempt with mismatched RLS context fails in an automated test (Phase 0 exit criterion).
- A new module can register tables + migrations + jobs without touching platform internals.
