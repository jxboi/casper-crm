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

## casper-events — P0 completion (comments + notifications)

The events module reaches its **P0 scope**: the two remaining consumers of the
stream — comments and in-app notifications — land as `@casper/events`. All real and
tested — **+7 tests** (`casper-events/src/comments-notifications.test.ts`), whole repo
**54 green** via `npx vitest run`.

| Package | Scope delivered |
|---|---|
| `@casper/events` (P0 finish) | **Comments** (`addComment`/`editComment`/`deleteComment`/`listComments`): timeline-native authored entries in their own `comments` table (soft-deleted, so the audit trail + create event survive), each write also emitting a `comment.*` domain event; **@mentions** encoded `@[Name](id)`, parsed and validated against active workspace memberships (so a comment can only mention a real teammate); author-only edit/delete. **Notifications** (`listNotifications`/`unreadCount`/`markRead`/`markAllRead`): an in-app inbox filled by *consumers* of the stream — `notify-mentions` (on `comment.created`) and `notify-task-assigned` (on `task.created`/`task.updated`) — idempotent under redelivery via a `(sourceEventId, userId, type)` unique index. |

Verified: a comment lists and lands on the record timeline; an @mention notifies the
mentioned teammate but never the author; mentions of non-members are dropped; unread
count + recipient-only `markRead`; author-only edit/delete with the timeline reflecting
edits/deletions **live**; task-assignment notifies the assignee (not on self-assignment)
on both create and update; redelivery does not double-notify.

### Deviations & refinements (events P0 finish, flagged per working style)

1. **Comments are surfaced on the timeline from the `comments` table, not from a
   `timeline_entries` projection.** The generic timeline projector now *skips*
   `comment.*` events; `getTimeline` merges `timeline_entries` with a live per-record
   comment query. This keeps edits/deletes correct without the jsonb-update dance a
   projected-then-patched entry would need, and still isn't an on-the-fly join over raw
   `domain_events` (both sides are per-record and indexed). The plan's "authored timeline
   entries" is honored; the storage placement is the refinement.
2. **`@casper/events` now depends on `@casper/auth`** (the plan header already lists auth
   as a dependency; no cycle — auth imports only platform). Used solely to validate
   mention ids against `memberships` inside the author's own tx, so RLS prevents
   cross-org mentions. Task-assignment needs no auth read — the assignee id rides the
   event payload.
3. **Notification rules read field-key conventions off the event payload, not the records
   schema** (`data.assignee` on `task.created`, the `assignee` diff entry on
   `task.updated`). Events must not import records (that would be a cycle), so the
   consumer knows the *convention* without the type — a new rule is still added here
   without touching any write path.
4. **Email delivery + the per-user preference matrix stay deferred to Phase 1c** (plan
   allowance under D-017): with a single dogfood user, the in-app inbox is enough. This
   increment is the inbox they build on.

## casper-sales — P1a (Dogfood CRM: the first product, config-only)

The first **product** module lands as `@casper/sales` (workspace member #7) — and it is
the proof of the engine/product split: **record types, pipeline, automations, views,
terminology, and seed data expressed purely as config over the existing engine, with
zero engine code changes and no schema of its own.** All real and tested — **+6 tests**
(`casper-sales/src/sales.test.ts`), whole repo **60 green** via `npx vitest run`.

| Package | Scope delivered |
|---|---|
| `@casper/sales` (new, member #7) | **Record types** (`RecordTypeDef` config, D-013): **Company** (name, unique domain, industry/size/region), **Contact** (name, email, phone, title, company relation, source, notes), **Deal** (name, company + contacts + primaryContact relations, `sensitive` money `amount` in SGD minor units per D-012, stage, `stageEnteredAt`, expected/next-action dates, source, lostReason). **Pipeline workflow** (config on the workflow engine): `New → Qualified → Proposal → Negotiation → Won \| Lost`; guards — amount + expected close required to enter Proposal, lost reason required to enter Lost (reachable from any open stage via `from: "*"`); Won/Lost → Qualified re-open transitions. **Neglect** as two SLA rules (inactivity ≥14d, stage-age ≥30d) both emitting `record.neglected`. **Default automations**: Won ⇒ create high-priority onboarding task (the canonical example); Lost ⇒ notify (in-app). **Default views** (created per workspace, idempotent): Pipeline (board by stage), My open deals (personal), Neglected deals (shared), All companies, All contacts. **Terminology map** (engine noun/verb → sales labels) for casper-web. **Seed runner** `seedSalesData({ variant })` (D-017 dogfood data source): `demo` (3 companies, 4 contacts, 5 deals across the pipeline incl. 2 already-neglected) and `founder` (views only); idempotent, all writes through the records single write path so seeding produces real audit + timeline history. This is the function `pnpm play sales` will drive once the playground host lands. |

Verified: a deal validates + writes through the records path with the config-defined
default stage and a mirrored relation edge; the Proposal guard blocks without
amount+close and passes once set (stamping `stageEnteredAt`); Lost requires a reason;
the Won automation creates the onboarding task (`source: automation`, high priority,
related to the deal); the Neglected-deals filter + the SLA scan surface exactly the
overdue/stuck deals and emit `record.neglected`, excluding healthy and closed deals;
`seedSalesData` is idempotent (re-run is a no-op for records) and wires company↔contact /
deal relations.

### Deviations & refinements (sales P1a, flagged per working style)

1. **Manager-only re-open is not enforceable as pure config** — the plan asks that only
   Manager+ re-open Won/Lost deals, but the guard model's `permission` is a single action
   checked against the record, and the built-in grants separate manager from member by
   *scope* (own vs team), not by a distinct re-open action. Per the plan's own rule ("if it
   needs an engine change, that's a signal the engine needs a capability"), the re-open
   transitions ship with the default `record.transition` permission; a dedicated
   `record.reopen` action + grant is flagged for **casper-auth**, not hacked into product config.
2. **"Next action date overdue" lives in the Neglected-deals view filter, not an SLA rule** —
   SLA *kinds* are `inactivity` / `stage_age` only, so the third neglect signal is expressed
   as a Filter-AST leaf (`nextActionDate older_than {0, day}`) in the view. Both read the same
   records; the view is the authoritative neglected list, the SLA scan is the event trigger.
3. **Neglect SLA rules are not stage-scoped to "open"** — an SLA rule scopes to one stage or
   none, so the inactivity/stage-age rules can technically emit `record.neglected` on a closed
   deal. The **view** filter restricts to open stages; a category-aware SLA scope (open/won/lost)
   is a small engine capability flagged for **casper-workflow**. Low impact (a stale closed deal
   is rare and the assistant re-checks open-ness in P1b).
4. **"Closing this month" view deferred** — it needs a future-facing/absolute date-range
   operator (`within_next` or a bounded range); the Filter AST has only past-relative operators
   (`within_last`/`older_than`). Flagged for **casper-records**; the other four default views ship.
5. **Single email/phone per contact, currency folded into the money value** — multi-email/phone
   and a separate currency field are refinements; P1a uses one `email`/`phone` and lets the
   money field carry its ISO currency (D-012). No engine limitation, just scope.
6. **Seed data ages via past date fields, not clock manipulation** — `lastActivityAt` can't be
   backdated through the write path, so seeded "neglected" deals are made so via a past
   `nextActionDate` / an aged `stageEnteredAt` (the two neglect signals that are settable data),
   keeping the seed a clean, side-effect-free set of normal writes.

## casper-web — first engine wiring (D-018 vertical slice)

The web app stops being a disconnected prototype: the **Pipeline board now runs on the real
engine, in-process, inside the Next server.** Seeded deals render through relations; drag-to-
transition goes through the pure workflow guard → `can()` → the records write path →
`stage_changed` → automations, and persists to PGlite. Verified end-to-end in the browser +
via a throwaway route (since removed): a legal move persisted, an illegal move was rejected by
the engine (`no transition 'qualified' → 'won'`), and `deal.stage_changed` hit the audit log.

| Area | What landed |
|---|---|
| Workspace | `casper-web` joined the pnpm workspace (D-019 — one monorepo); npm lock removed; `@casper/*` + `drizzle-orm` + `@electric-sql/pglite` added as deps. |
| Engine runtime (`lib/server/engine.ts`) | In-process bootstrap: registers every module, brings up **PGlite** (D-019, the Neon swap is prod-only), migrates, and seeds a dev org/workspace + the sales demo dataset. Dev **principal** = a Manager (OAuth login still deferred); every UI action runs through `can()` + the single write path under it. |
| BFF (`lib/server/actions.ts`, `map.ts`, `context.ts`) | Next **Server Functions** as the web↔engine layer: `loadPipeline`, `moveDealStage` (marks-Lost writes the guard-required reason then transitions). `withEngine` opens the dev tenant context per call; mappers translate engine `RecordModel`s → the web view types, so the UI is untouched by the switch. |
| UI | `app/pipeline/page.tsx` rewired from the zustand mock to the BFF (reads + transition + neglect badges on real data); `LostReasonDialog` made transport-agnostic (`onConfirm`). |

### Infra decisions & gotchas (flagged — these recur for all future web wiring)

1. **Transport = Next Server Functions, not tRPC (deviation from D-018).** Native to the App
   Router, zero extra deps, lowest blast radius in this non-standard Next 16. The typed tRPC
   client earns its place with the AI run streams (P1b); the transport is swappable without
   touching the UI. Flagged for the plan.
2. **`next dev --webpack`, not Turbopack.** The `@casper/*` packages use `moduleResolution:
   bundler` but write NodeNext-style `.js` specifiers pointing at `.ts` sources. tsc/vitest
   tolerate this; Turbopack has no `extensionAlias` and can't resolve `./x.js`→`./x.ts`. Webpack
   can (`config.resolve.extensionAlias` in `next.config.ts`), so this app runs webpack. (Cleaner
   long-term fix: make the engine imports extensionless, matching `bundler` resolution.)
3. **PGlite is a `serverExternalPackages` entry; `@casper/*` are `transpilePackages`** (raw TS,
   so the bundler must compile them — they can't be externalized like a built dep).
4. **Module-graph duplication.** Next bundles Route Handlers / Server Actions / RSC into
   *separate* module graphs, so the engine's module-level singletons (the record/workflow
   registries, the `setDb` handle) are duplicated per graph. The bootstrap therefore splits into
   `registerAll()` (idempotent in-memory registration, run on **every** `getEngine()` so each
   graph's registries are populated) + `provision()` (create DB + migrate + seed **once**, cached
   on `globalThis`, holding the shared PGlite handle every graph's `setDb` is pointed at).

### Scope (wired so far: Pipeline board + deal detail)

Wired + verified on the real engine:
- **Pipeline board** — reads, drag-to-transition, neglect badges.
- **Deal detail** (`app/deals/[id]/page.tsx`) — company + contacts resolved through relations;
  stage controls via `moveDealStage`; inline field edits (`updateDealField`) and task add/toggle
  (`addDealTask`/`toggleDealTask`) through the records write path; the **timeline** rendered from
  the events projection (`getTimeline`). Verified in-browser: transitioning Proposal→Negotiation
  updated the stage, offered the new legal targets, and grew the timeline to 3 events
  (`deal.stage_changed` + `deal.updated` + `deal.created`).

New BFF surface for detail: `getDealDetail`, `updateDealField`, `addDealTask`, `toggleDealTask`
(all via `withEngine` → module API → `loadDetail` re-read); mappers `toWebTask` /
`toWebTimelineEvent`.

**Still on the mock zustand store** (next increments): the deals / companies / contacts **list
views**, and the **AI dock / feedback / change-set-approval** flows (they need casper-ai +
casper-changesets wiring). The shell's "acting as" user switcher is also still mock (single dev
principal until login lands).

## Not yet built (next P0 increments)

auth OAuth login/session; the `casper-records` Filter-AST playground + `casper-auth`
`can()` playground (D-025) and the `tooling/playground` host/kit; CSV export (P1);
config-snapshot persistence to
`record_types`/`field_defs`; **casper-web wiring beyond the Pipeline board** (deal detail,
list views, AI/feedback/approvals still on the mock store — see the casper-web section above).
Relations cascade-on-archive is stubbed (edges maintained, enforcement deferred).
