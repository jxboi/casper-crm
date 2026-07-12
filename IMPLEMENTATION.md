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

## Not yet built (next P0 increments)

auth OAuth login/session; the `casper-records` Filter-AST playground + `casper-auth`
`can()` playground (D-025) and the `tooling/playground` host/kit; events
notifications/comments; CSV export (P1); config-snapshot persistence to
`record_types`/`field_defs`; casper-web wiring (the current web app is a
disconnected prototype). Relations cascade-on-archive is stubbed (edges maintained,
enforcement deferred).
