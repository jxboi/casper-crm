# tooling/playground — Plan

**Status:** Draft v0.2 | **Layer:** Tooling (not a domain module) | **Phases:** 0+ | **Depends on:** any one `casper-*` module at a time (dev-only) + `tooling/playground-kit` | **Used by:** — (never deployed) | **Aligned with:** master-plan v0.5 (D-001, D-002, D-019, D-022, D-025)

## Purpose

The dev-only **playground host**: a thin Next.js app that mounts one module's playground surface at a time so a module can be exercised in isolation — including the server-side ones, since surfaces run as server components with direct access to the module's public API and the dev database. This doc also covers the sibling package `tooling/playground-kit`. Neither is a domain module; both carry zero domain logic.

Per D-025 the playground is an **opt-in pattern, not a per-module mandate.** The host + kit are the load-bearing investment; individual module surfaces are added only where the payoff is real — a module earns a surface when its internals are rich and lack a natural UI early, not by default.

## What gets built, and when

- **Host + kit — Phase 0.** The shared shell, principal switcher, dev-context bootstrapper, viewers, and safety rails.
- **Committed initial surfaces:** casper-auth (`can()` explorer) and casper-records (Filter AST builder) in Phase 0; casper-workflow (pure `evaluate()` scratchpad) and casper-ai (run/tool inspector) in Phase 1.
- **Opt-in surfaces:** every other module adds one only on demonstrated need (see each module plan's Playground section). casper-events (event tail) and casper-changesets (diff/approve) are the strongest remaining candidates; casper-platform, casper-sales, and casper-api mostly overlap with the test kit, seeded-config composition, and `npx workflow inspect`, and default to none. casper-web has a component gallery, not a module playground.

## How it runs

- `pnpm play <module>` (root script) → sets `PLAYGROUND_MODULE=casper-<module>` and starts the host's Next dev server (optional `--port` for two hosts side by side).
- The host resolves `@casper/<module>/playground` via **dynamic import** — only the selected module's graph is compiled; a module with no surface, or a broken one, never affects the others.
- A module's surface is a **playground manifest**: `{ title, scenarios: [{ path, label, component }] }` exported as the subpath export `@casper/<module>/playground`. Scenario components are React server/client components importing only that module's public API + the kit.

## Playground kit (`tooling/playground-kit`)

A separate package — module surfaces import it and the host imports module surfaces, so folding it into the host would create an import cycle.

- **Shell:** layout, scenario nav, dev-context status bar.
- **Dev principal switcher:** act as any dev user/assistant/api_key principal; the choice flows into every module API call — the cheap way to exercise `can()` (D-004/D-020) and assistant capping (D-022).
- **Dev-context bootstrapper:** `ensureDevContext()` — idempotently creates the dev org/workspace/teams/users/assistant principals via casper-auth's public API; optional casper-sales seed for engine scenarios.
- **Widgets:** JSON viewer, record/change diff viewer, live event-tail, typed-input forms for invoking module APIs.

## Safety rails

- **Never deployed:** not linked to any Vercel project (D-019's single deployed project is casper-web); nothing in production imports playground code.
- **Dev-database-only:** the kit refuses to boot when `NODE_ENV=production` or the configured database is not a designated dev database/branch (explicit allowlist).
- **Boundary lint (D-001 mechanism):** only `tooling/playground` may import `@casper/*/playground`; surfaces import only their own module's public API + the kit. Principal impersonation lives only in the kit, never in casper-web.

## Alternative considered — gated `/dev` in casper-web

Instead of a standalone host + kit, a gated `/dev/*` area inside casper-web could host the same tools with far less machinery: no dynamic-import host, no separate kit package, no cross-module boundary rules. It gives up "run module X while module Y is broken" isolation — worth little for a solo developer working one module at a time. **Retained as the fallback:** if the host/kit proves heavier than its payoff during the Phase-0 build, collapse to `/dev`-in-web and keep the same manifest shape so surfaces don't change.

## Non-goals

- Not a 13th domain module; no domain logic, schema, or events.
- Not a Storybook replacement for casper-web polish (casper-web may keep its own component gallery).
- Not a second product UI — anything user-facing belongs in casper-web.

## Success criteria

- `pnpm play <module>` boots a committed surface against a fresh dev database in one command (bootstrapper does the rest).
- Adding a surface is cheap enough that the opt-in policy is real — a manifest plus a few components, no host changes. If it isn't, that's the signal to fall back to `/dev`-in-web.
- Grep-level guarantee: no production package imports `*/playground` or the kit.
