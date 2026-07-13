# Implementation status — Phase 0 (records-first)

First code lands. This session built the **records engine to its P0 scope**, plus
the minimum foundation it depends on, as a pnpm + Turborepo monorepo (D-001). All
of it is real and tested — no stubs on the data path.

## What's built

| Package | Scope delivered |
|---|---|
| `@casper/platform` | Drizzle client over **PGlite** (dev/test) with the Neon driver wired behind config (D-019); `withTx`/`withSystemTx` (sets RLS session vars + assumes the app role); per-module migration registry + central runner; tenancy `requestContext` (AsyncLocalStorage); `AppError` taxonomy; uuidv7 ids; clock; config; logger; RLS helper; test kit. |
| `@casper/auth` | `Principal`; tenancy entities (org/workspace/team/membership/invitation) + service helpers; built-in roles as code-defined grant bundles; **`can()`** implementing D-020 (open read, scoped write own/team/workspace/org) with the D-020 team-union rule; RLS on tenant tables. |
| `@casper/events` | `DomainEvent` envelope (master §6); transactional outbox (`emit` in the caller's tx); consumer registry; post-commit `dispatchPending`; **audit log** + **record timeline** projections (idempotent, keyed by event id); interaction-events table. |
| `@casper/records` | Field registry + record-type config; **compiled-zod validation** (cached per type+version); **the single write path** (`create`/`update`/`archive`/`transitionOwner` + bulk) — `can()` → validate → persist (+version bump) → emit; optimistic concurrency; **Filter AST → parameterized SQL** (incl. relative-date + `no_activity_within`); saved views (table/board/list); relations join table; FTS search; system types Task/Note/Attachment; `last_activity_at` denormalizer. |

## Verification (18 tests, all green)

- **Single write path** — create/update emit a domain event and produce an audit
  entry + timeline item; grep confirms only `write.ts` mutates record
  data/version/ownership (`activity.ts` touches only `last_activity_at`).
- **`can()` gate** — a member cannot update another member's record; managers reach
  teammates' records via the team union; deactivated members are denied.
- **Optimistic concurrency** — a stale `baseVersion` raises a `conflict` AppError.
- **Filter AST** — `eq` / money `gt` / select `in` / `no_activity_within` compile
  and return the right rows; FTS + saved views run through the same engine.
- **Tenant isolation (Phase 0 exit criterion)** — a second org sees none of the
  first org's records; enforced by Postgres RLS, not just app code.

Run: `pnpm install && pnpm test` (and `pnpm typecheck`). Tests use in-process
PGlite — no database server or Neon provisioning needed.

## Deviations & refinements from the plans (flagged per working style)

1. **`Principal` type lives in `@casper/platform`**, not `@casper/auth`. The tenancy
   context (platform, the root of the dep graph) must carry it; auth still owns all
   the *logic* (`can()`, principal creation) and re-exports the type. Resolves the
   import-direction cycle. (Refines master §6 attribution.)
2. **RLS is enforced via a non-superuser app role** (`casper_app`); `withTx` does
   `SET LOCAL ROLE`. Postgres superusers bypass RLS even with FORCE, so this is both
   what makes the isolation test real under PGlite and the production posture (the
   app connects to Neon as a limited role). Platform bootstrap migration creates it.
3. **`last_activity_at` is maintained by a records-owned event consumer**, not by
   events writing the records table — honoring D-001 (no module writes another's
   table). The events plan described it as events-side; this is the boundary-clean
   placement.
4. **better-auth OAuth login is deferred within `@casper/auth`.** Records and the
   engine depend on principals + `can()`, not the login flow, so P0 built the
   authorization core + tenancy first. AuthN (GitHub OAuth + email/password) is the
   next auth increment.
5. **Migrations are per-module SQL DDL + a central runner** (not drizzle-kit
   generate). Keeps the foundation self-contained and offline; matches the plan's
   "per-module migration registration + central runner" intent.
6. **PGlite is the dev/test database.** Real Postgres in WASM, so RLS / generated
   columns / FTS all behave; the Neon serverless driver is the prod swap behind
   config, no module changes.

These are engine/foundation refinements. If you want them rippled into the affected
`plan.md` headers (status → "P0 in progress") and a decision note (D-026?) for the
`Principal`-in-platform + app-role-RLS choices, say the word and I'll promote them
to the master plan in the same pass.

## casper-workflow — P1a (engine increment)

The first workflow increment lands as `@casper/workflow` (workspace member #5), built on
the records write path. All real and tested — **13 tests green** (`casper-workflow/src/engine.test.ts`).

| Package | Scope delivered |
|---|---|
| `@casper/workflow` | Versioned **workflow definitions** (zod, config-as-data) in an in-memory registry (`defineWorkflow`, mirroring `defineRecordType`) + a `workflow_definitions` snapshot table; the **pure `evaluate(definition, record, intent, now) → Effect[]`** (D-014 — no I/O, no clock, no randomness) with an in-memory Filter-AST interpreter (twin of `compileFilter`); the **`transition()` API** (the sole way stage changes: pure guards → `can('record.transition')` → persist via `updateRecord` → emit `<type>.stage_changed`); **simple assignment** (`fixed` / `by_field`, executed through the records write path); the **`scanSla()`** staleness scan (inactivity / stage-age via the Filter AST → `workflow.sla_breached` / `record.neglected`). |

Verified: pure `evaluate()` returns effects while touching no DB and reading no clock;
legal/illegal transitions; all three guard types (required-fields, in-memory condition,
`can()` permission — member-off-team denied, manager-on-team allowed); `stage_changed`
emitted alongside `deal.updated`; `fixed`/`by_field` assignment; SLA inactivity + stage-age
scans emit for the right records only; tenant isolation under a system-principal scan.

### Deviations & refinements (workflow P1a, flagged per working style)

1. **Stage stays in `records.data.stage`** (the plan's open question defaulted to a dedicated
   column). A column needs a coordinated `casper-records` schema + write-path change, which
   would break a self-contained increment; the Filter AST already handles `data.stage`.
   Deferred to **P2** as a board-performance optimization; `plan.md` open question updated.
2. **`stage_changed` is emitted non-atomically** — persistence goes through the records single
   write path (`updateRecord`, the grep-enforced sole mutator of `records.data`, which emits
   `<type>.updated`), then `transition()` emits the semantic `<type>.stage_changed` in a second
   tx (sharing the request `correlationId`). Editing `casper-records` was out of scope; a P1b
   write-path hook makes the two atomic. Note: `transition()` therefore also requires
   `record.update` — every role granting `record.transition` grants `record.update` at the same
   scope, so this never bites in practice.
3. **On-create assignment is a service-layer call** (`onRecordCreated`), **not** an
   `on('<type>.created')` consumer. Consumers run inside `dispatchPending`'s `withSystemTx`;
   invoking the write path there would nest transactions and recursively dispatch on PGlite's
   single connection (the records `activity.ts` consumer avoids this by writing via the passed
   `tx`). The consumer form arrives with the P1b post-commit automation runtime.
4. **`round_robin` assignment excluded from P1a** — it is impure (needs live counts). P1a ships
   the pure subset (`fixed`, `by_field`); `round_robin` lands in P1b with the runtime.

### Harness note (pre-existing, not introduced here)

`pnpm test` / `pnpm --filter <pkg> test` report "No test files found" for **every** package —
turbo runs each package's `vitest run` with cwd = the package dir, but the root
`vitest.config.ts` glob (`casper-*/src/**/*.test.ts`) is repo-root-relative, so it matches
nothing from inside a package. The suites run correctly from the repo root: `npx vitest run`
(all 31 tests green) or `npx vitest run casper-workflow/src/engine.test.ts`. A monorepo fix
(a vitest projects/workspace config, or per-package configs) is worth a separate pass.

## Workflow P1b + casper-changesets P1 (automation + publishing via change sets)

Two subsystems land: the workflow **automation engine** and **publishing routed through a
real change-set module**. All real and tested — **+13 tests** (5 workflow automation, 8
changesets, 3 events emission-context), whole repo **47 green** via `npx vitest run`.

| Package | Scope delivered |
|---|---|
| `@casper/events` | **Emission context** (D-026): `withEmissionContext({causationId?, source?})` — an ambient scope `emit()` reads as a fallback, so change-set commits and automation effects stamp causation/source without threading them through every write signature. `subject_id`/`record_id` columns widened to `text` so `ConfigRef` subjects (config-publish events) are storable per master §6. |
| `@casper/changesets` (new, member #6) | The change-set engine: lifecycle (`createChangeSet`/`addChange`/`submitForReview`/`approveChange`/`rejectChange`/`approveAll`/`commitChangeSet`); **computed risk** (D-007); draft-time validation via each owning module's validator; ops `create`/`update`/`transition`/`delete`/`config_publish`; **commit through module write APIs** (never direct table writes) under the system principal, inside a `causationId = changeset` emission scope; `baseVersion` conflict detection (stale → blocked, `change.flagged_stale`); overlay (`readThroughChangeset`) + preview/diff; `changeset.approve`-gated approval with **no-self-approval** for high-risk in multi-seat orgs (single-seat exempt, D-017). |
| `@casper/workflow` (P1b) | **Publishing primitives** (`applyConfigPublish`, `diffWorkflow`, `listVersions`, `loadActiveWorkflows`) that changesets drives via `config_publish` — immutable version N+1, `status` repoint = rollback; `workflow.published` tightened. **Automation engine:** `automation-definition` (trigger/condition/`Action`), in-memory registry, pure `evaluateAutomation()`, a persisted `automation_runs` queue + post-commit driver `runPendingAutomations()`, the 4 actions, and causation-depth loop protection. |

### Key architecture decisions (D-026)

1. **Dependency direction `casper-changesets → casper-workflow`** (one-way): workflow exposes
   config primitives; changesets owns the publish lifecycle and calls `applyConfigPublish` on
   commit. Workflow never imports changesets — no cycle, and commit still "applies through
   module APIs" (D-006).
2. **The dispatch-nesting problem, solved by a queue.** Event consumers run inside
   `dispatchPending`'s `withSystemTx`, so the automation consumer only *enqueues* `automation_runs`
   rows (a plain insert on the dispatch tx); the post-commit driver drains and executes actions
   in their own transactions. This is the "post-commit execution queue" P1a's deferred on-create
   assignment was waiting on.
3. **Conditions evaluated at enqueue** (against the record state at the event, using the event's
   timestamp as `now`) — deterministic, and it distinguishes successive events on one record
   (→qualified then →won) where drain-time evaluation would double-fire.
4. **Loop protection = causation depth.** The emission context stamps
   `causationId = trigger event` on automation-effect events; the consumer walks the causation
   chain and, at `MAX_DEPTH`, records a `blocked` run instead of a `pending` one, so a
   self-triggering rule terminates with a bounded, visible run log.
5. **Automations + commits run as the system principal** — the `changeset.approve` gate is the
   authorization; effect events still carry `source: "automation"` / origin via the emission
   context, and created tasks carry `source: "automation"`.

### Deferred / flagged

Changesets P2/P3: compensating-op rollback, stale re-review flow, batch approvals, artifacts,
cross-changeset overlays. Workflow: event-payload automation conditions, same-automation &
per-record rate-cap loop guards, `round_robin`, on-create assignment as a consumer (now
unblocked by the queue but not yet wired), an atomic `stage_changed` write-path hook. Workflow
config (`workflow_definitions`/`automation_definitions`) remains **org-global** (no org_id) —
the P1a simplification; multi-tenant config isolation is a later concern.

## Not yet built (next P0 increments)

auth OAuth login/session; the `casper-records` Filter-AST playground + `casper-auth`
`can()` playground (D-025) and the `tooling/playground` host/kit; events
notifications/comments; CSV export (P1); config-snapshot persistence to
`record_types`/`field_defs`; casper-web wiring (the current web app is a
disconnected prototype). Relations cascade-on-archive is stubbed (edges maintained,
enforcement deferred).
