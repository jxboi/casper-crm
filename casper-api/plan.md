# casper-api — Plan

**Status:** Draft v0.1 | **Layer:** Application | **Phases:** 0+ | **Depends on:** all modules (host/composition) | **Used by:** casper-web (run streams, long ops), external consumers (P4 public API) | **Aligned with:** master-plan v0.3 (D-001, D-011, D-015 superseded, D-018, D-019)

## Purpose

The server-side execution surface of the modular monolith — deployed **on Vercel inside the same project as casper-web** (D-019), not a standalone service. This package owns everything that runs outside a user request: Workflow DevKit workflow definitions (AI runs, event fan-out, imports, syncs), Vercel Cron endpoints, run-streaming route handlers, and (P4) the public REST API. It composes modules; it contains no business logic of its own. If build times or blast radius ever demand it, this package can move to a second Vercel project without code changes — that split is the escape hatch, not the starting point.

## Scope

**In**
- **Composition (P0):** wires module APIs into the deployable surface — workflow registry (all module-defined `defineWorkflow`s exported to the WDK build), cron registry (module `defineCron`s composed into `vercel.json` `crons`, `CRON_SECRET`-verified), health endpoint, migration check on deploy, structured logging with tenancy context. There is no long-lived process to manage (D-019).
- **Workflows (P0+):** the durable work defined by modules and executed by WDK: event outbox fan-out (casper-events — triggered post-commit via `waitUntil`, swept by cron), automation execution (casper-workflow), the **AI run workflow** (casper-ai — per-turn steps, `createHook` approval pauses, org-level concurrency caps), notification delivery + digests (casper-events), CSV import (casper-records, P2), mailbox sync (casper-comms, P3), outcome measurement (casper-feedback, P3), retention pruning (platform, P3). Per-step retries; `FatalError`s park the run and alert (dead-letter semantics).
- **Cron (P0+):** SLA/neglect scans, digests, budget-counter resets, outbox sweeper, retention — declared by modules, registered here.
- **Run streaming (P1):** route handlers serving **WDK run streams** — `run.getReadable({ startIndex })` gives resumable, namespaced streams (agent output vs step/status events) delivered as SSE; auth via session. DB-persisted run events (casper-ai) remain the audit source of truth; the stream is the live view.
- **Internal HTTP (P1):** minimal route handlers for what doesn't fit tRPC — Vercel Blob client-upload token issuance, hook-resume endpoints where an external callback needs a URL.
- **Public REST API v1 (P4):** `/api/v1` — records CRUD + query (Filter AST subset), tasks, changesets read; API-key auth (casper-auth), per-key rate limits (platform + Vercel WAF); OpenAPI spec generated from zod schemas; **outbound webhooks** with HMAC signing, retries + backoff (as workflows), delivery log.
- **Ops (P0+):** Vercel Observability dashboards + log drains; workflow run inspection (`npx workflow inspect`, Vercel dashboard); alerting on workflow failure rates and outbox-sweeper lag; Sentry optional. Deploys are ordinary Vercel deploys with per-PR preview environments; **in-flight workflow runs survive deploys** (durable state) — a key D-019 win.

**Out**
- Business logic (modules), UI/BFF concerns and tRPC (casper-web, D-018), inbound third-party webhooks for integrations (future casper-integrations; mailbox sync uses polling/delta initially).

## Key design points

- **One project, two surfaces:** casper-web (user-facing routes + tRPC) and this package (workflows/cron/streams) deploy together as one Vercel project sharing one Neon Postgres; coordination happens through the DB + workflow runtime, never through private HTTP. Local dev stays `pnpm dev` + `npx workflow web` for run inspection.
- **AI runs are workflows:** multi-minute Claude loops with human-approval pauses map directly onto WDK — each model turn and each tool execution is a durable step; approvals are `createHook` suspensions costing zero compute while waiting; streaming is built in. Fluid Compute's Active-CPU pricing means await-heavy agent turns bill only for actual CPU time.
- **Everything resumable:** workflow state survives crashes *and deploys*; streams resume via `startIndex`; the sweeper cron guarantees outbox delivery. Deploys must be boring.
- **WDK maturity hedge (master-plan §11):** P0 includes a short spike proving local dev, `@workflow/vitest` testing, and observability before the AI run engine commits to WDK. Documented fallback if it disappoints: Fluid functions + an outbox-table job runner (cron-drained), same module-facing `defineWorkflow` contract so callers don't change.
- **Public API is a thin veneer (P4):** it exposes the same module APIs used internally with the same `can()` enforcement — no parallel logic, no privileged paths.

## Phasing

- **P0:** composition skeleton (workflow + cron registries); outbox fan-out live (`waitUntil` trigger + sweeper cron); WDK spike (dev/test/observability); health; deployed with CI as a single Vercel project + DB migrations.
- **P1:** AI run workflow + run-stream route handlers; automation + notification workflows; SLA cron.
- **P2:** digest cron; budget resets; CSV import workflow; workflow-failure + sweeper-lag alerting.
- **P3:** mailbox sync workflows; measurement + retention jobs.
- **P4:** public REST v1 + outbound webhooks + OpenAPI + key management.

## Open questions

- Single Vercel project vs a second project for the workflow/cron surface — start single; revisit only if build times or function-count limits bite.
- WDK spike acceptance bar (P0): local iteration speed, integration-test ergonomics, stream resume behavior under deploy — define pass/fail before starting Phase 1b.

## Success criteria

- P0: a crash or timeout between commit and dispatch loses nothing — the sweeper redelivers within a minute (automated test).
- P1: an AI run survives a production deploy mid-run (resumes or fails cleanly, never half-committed), and a browser refresh mid-run reattaches to the stream with full history via `startIndex`.
- Workflow failure-rate and sweeper-lag alerting exist before Phase 1 exit (we must notice problems before design partners do).
- P4: public API endpoints are provably the same code paths as internal usage (no logic forks).
