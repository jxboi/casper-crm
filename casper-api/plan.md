# casper-api — Plan

**Status:** Draft v0.1 | **Layer:** Application | **Phases:** 0+ | **Depends on:** all modules (host/composition) | **Used by:** casper-web (SSE, long ops), external consumers (P4 public API) | **Aligned with:** master-plan v0.2 (D-001, D-011, D-015, D-018)

## Purpose

The server runtime — the second half of the two-runtime modular monolith (D-001). One deployable Node service (Fastify or Hono) that hosts everything that can't or shouldn't run in serverless web functions: job workers, the AI run executor, event dispatch, cron schedules, SSE streaming, and (P4) the public REST API. It composes modules; it contains no business logic of its own.

## Scope

**In**
- **Process & composition (P0):** boot sequence — config validation, migration check, module wiring (explicit dependency injection of module APIs), pg-boss start, health/readiness endpoints, graceful shutdown (drain jobs, close SSE), structured request logging with tenancy context.
- **Job workers (P0+):** executes jobs defined by modules via platform `defineJob`: event outbox dispatcher + consumer fan-out (casper-events), automation execution (casper-workflow), AI run executor (casper-ai — long-lived, concurrency-capped per org), notification delivery/digests (casper-events), SLA/neglect scans (casper-workflow cron), import processing (casper-records), mailbox sync (casper-comms P3), outcome-measurement jobs (casper-feedback P3), retention pruning (platform P3). Worker concurrency tuned per queue; poison-message handling to dead-letter with alerting.
- **Cron (P0+):** SLA scans, digest schedules, budget-counter resets, retention jobs — registered declaratively by modules, executed here.
- **Streaming (P1):** SSE endpoints for AI run events (`/runs/:id/stream`) and change-set status; auth via session cookie/token; resume via `Last-Event-ID` against persisted run events (source of truth is the DB — a dropped connection loses nothing, D-011).
- **Internal HTTP (P1):** minimal endpoints for operations the web runtime can't do well (large file upload handoff, import kickoff) — everything else stays in-process in web via module APIs.
- **Public REST API v1 (P4):** `/api/v1` — records CRUD + query (Filter AST subset), tasks, changesets read; API-key auth (casper-auth), per-key rate limits (platform), OpenAPI spec generated from zod schemas; **outbound webhooks** with HMAC signing, retries + backoff, delivery log, endpoint management UI hook.
- **Ops (P0+):** metrics endpoint (job throughput/latency, run durations, queue depth, SSE connections), Sentry integration, deploy config for Railway/Fly (Q-2), zero-downtime deploy pattern (stop-polling → drain → swap).

**Out**
- Business logic (modules), UI/BFF concerns (casper-web), inbound third-party webhooks for integrations (future casper-integrations; mailbox sync uses polling/delta initially).

## Key design points

- **Two runtimes, one codebase, one DB:** web (Vercel) and this service both import the same module packages and hit the same Postgres; coordination happens through the DB + pg-boss, never through private HTTP between the two. Keeps local dev trivial (`pnpm dev` runs both) and avoids internal-API versioning. Note (D-018): the tRPC layer lives in casper-web and does not replace this service's roles — SSE streaming, jobs, and the P4 public REST API stay here.
- **AI runs need this process:** multi-minute model loops with tool calls don't fit serverless limits — the run executor lives here by design, streaming progress via persisted run events → SSE (D-011).
- **Everything resumable:** SSE resume from event log; jobs idempotent (platform convention); run executor resumes or fails runs cleanly on restart. Deploys must be boring.
- **Public API is a thin veneer (P4):** it exposes the same module APIs used internally with the same `can()` enforcement — no parallel logic, no privileged paths.

## Phasing

- **P0:** service skeleton, module wiring, pg-boss + outbox dispatcher live, health/metrics, deployed with CI alongside web + db migrations.
- **P1:** AI run executor + SSE streaming; automation + notification workers; SLA cron; import jobs.
- **P2:** digest cron; budget resets; queue observability dashboards; alerting.
- **P3:** mailbox sync workers; measurement + retention jobs.
- **P4:** public REST v1 + webhooks + OpenAPI + key management.

## Open questions

- Q-2 (master): Railway vs Fly.io (default: Railway for simplicity; Fly if we want multi-region later).
- Fastify vs Hono (default: Hono — lightweight, same idioms as edge handlers; Fastify if plugin ecosystem needed).
- SSE vs WebSocket for run streaming (default: SSE — one-directional, resume semantics, simpler infra; revisit only if bidirectional needs appear).

## Success criteria

- P0: killing the service mid-event-dispatch loses nothing (outbox redelivers after restart) — automated test.
- P1: an AI run survives a worker restart (resumes or fails cleanly, never half-committed), and a browser refresh mid-run reattaches to the stream with full history.
- Queue depth and job failure alerting exist before Phase 1 exit (we must notice problems before design partners do).
- P4: public API endpoints are provably the same code paths as internal usage (no logic forks).
