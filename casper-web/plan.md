# casper-web — Plan

**Status:** v0.3 — **engine wiring in progress**: the Pipeline board, deal detail (reads via relations, guarded transitions, inline field edits, task CRUD, event-projected timeline), and the Deals/Companies/Contacts **list views** run on the real in-process engine (PGlite) via a Server-Functions BFF. The **AI dock** now reads real neglected deals from the engine, and the **approval flow — dock Changes tab + the Approvals inbox — runs on the real `casper-changesets` module** (D-006): the run stages a real change set (draft → in-review), per-change approve/reject go through the engine, and commit applies the approved subset **through the records write path** under the system principal, every event stamped `causationId = changeset` so committed tasks + field edits land in the real audit log + deal timeline attributed to the run. Nothing touches a record until commit — the safety property is structural now, not narrated. The **conversation/plan surfaces now stream from the real casper-ai run engine**: `POST /api/ai/run` runs the model/tool loop in-process and streams `RunEvent`s as SSE; the dock renders live model text, tool calls, plan-step progress, and email-draft artifacts (drafts stay client-side Workspace deliverables — they are artifacts, not record ops). The pre-run clarify exchange ("all deals vs closing this month") is still scripted in the store — it shapes the request string; engine-side clarifying/plan-approval states land in P1c. Feedback still on the mock store; login deferred (single dev principal). Prototype UI otherwise complete. See IMPLEMENTATION.md "casper-web" for infra decisions (webpack + `.js`→`.ts` extensionAlias; module-graph-safe bootstrap; Server Functions instead of tRPC for now). | **Layer:** Application | **Phases:** 0+ | **Depends on:** all modules (composition surface) | **Used by:** end users | **Aligned with:** master-plan v0.8 (D-001, D-010, D-017, D-018, D-019, D-020, D-024, D-025)

## Purpose

The product's face: a fast, responsive Next.js application composing every module into the Sales CRM experience — records UI, pipeline, tasks, timelines, the four AI surfaces, the approvals inbox, admin, and the feedback widget. Design stance (D-010): **web is where the business is configured and managed; mobile browser is where users act quickly** (approve, complete, reply, check). AI accelerates work; it never replaces direct manipulation — every AI-supported action has a one-click manual path.

## Scope

**In**
- **Foundation (P0):** Next.js App Router + Tailwind + shadcn/ui; auth pages (sign-up/in, invite acceptance, org/workspace creation); app shell — org/workspace switcher, nav, user menu, notification bell; error/empty/loading states as first-class components.
- **Records experience (P0–P1):** type-driven **table views** (TanStack Table; server-driven Filter AST querying; column config; saved views UI); **record detail** — field panel (inline edit → direct write path), timeline (casper-events projection), tasks, related records, attachments; **pipeline board** (drag between stages → `workflow.transition`, optimistic with guard-failure rollback); **tasks inbox** (my tasks, due today, overdue); global search (cmd-k palette P2); CSV import wizard (P2 — dogfood uses seed data, D-017).
- **AI surfaces (P1, D-010):** persistent **AI dock** (right-side panel, per-workspace) hosting the four surfaces per run — **Conversation** (chat, streaming via SSE), **Plan** (scope/steps/tools card with approve/narrow/edit/cancel), **Workspace** (artifacts: email drafts, summaries), **Changes** (record-level diff list: field before/after, per-change approve/reject, approve-all, commit state). Run history per user. Entry points: dock, record-page contextual actions ("prepare follow-up"), neglected-deals view bulk action.
- **Approvals inbox (P1):** all change sets awaiting my approval across origins (AI runs, workflow publishes); batch approval UX (P2); **mobile-first layout** — approving from a phone is a core flow, not an afterthought.
- **Admin (P1–P2):** members & roles (casper-auth; built-in roles per D-020, no Guest), teams management, member deactivation + bulk "reassign all records to X" flow (P2, D-024), field editor, workflow editor (list-based stage/transition/guard editing P1; visual graph P3), automation editor + run log, assistant policy editor (P2), audit log browser, org settings (incl. `managerModel`, D-021).
- **Feedback widget (P1):** floating trigger + element-target picker; auto-context capture (route, record, state); screenshot grab; submission < 15s (casper-feedback's success criterion is enforced here).
- **Notifications (P1):** inbox panel, unread badges, prefs page.
- **Change studio (P3):** feedback → themes → proposals → simulation results → pilot → outcome, one connected view (casper-feedback's UI).
- **Mobile/PWA (P2):** responsive throughout from P0; P2 adds PWA manifest + polish for the "act quickly" set: approvals, tasks, notifications, record quick-view, AI chat. Native app explicitly deferred until usage proves need.
- **Quality bars:** Playwright e2e for happy paths (auth → create deal → move stage → assistant run → approve → verify timeline); a11y basics (keyboard nav, focus, contrast); performance budgets (board interaction < 100ms, list P95 < 200ms server-side per casper-records).

**Out**
- Business logic (modules), long-running/background execution + SSE origin (casper-api), marketing site (separate, later), theming/white-label (future).

## Key design points

- **Data access pattern (D-001/D-011/D-018):** **tRPC** (Q-4 resolved in master-plan v0.2). Routers live in casper-web's server layer; procedures are thin, logic-free wrappers over module public APIs (same monorepo; web runtime talks to the same Postgres); React Server Components may still call module read APIs directly where a procedure adds nothing. Anything long-running (AI runs, imports, syncs) starts a Workflow DevKit run (D-019); live run/step streaming is consumed from casper-api's run-stream route handlers backed by resumable workflow streams (tRPC does not carry streams). Same Vercel project, so all of this is one deploy with per-PR previews.
- **Optimistic UI with guard honesty:** board drags and quick edits apply optimistically but surface guard/validation failures loudly (workflow guards are product behavior, not errors to hide).
- **Diff rendering is a core component:** the change-diff viewer (field before/after, risk badges, stale markers) is shared by AI Changes surface, approvals inbox, workflow publish preview, and rollback preview — build once, polish continuously (it *is* the trust UI).
- **Terminology layer:** UI copy resolves through casper-sales' terminology map so the engine stays generic while the product feels purpose-built (reference doc §5).

## Phasing

- **P0:** foundation + records table/detail v1 + Task UX + timeline + deployed shell.
- **P1a (dogfood CRM first, D-017):** pipeline board, saved views, tasks inbox, timeline polish — good enough that the founder runs his real pipeline here daily.
- **P1b (M1 demo slice):** AI dock (all four surfaces, minimal polish), approvals inbox, diff viewer v1.
- **P1c:** feedback widget, notifications UI, admin v1, in-app notification email prefs.
- **P2:** design-partner readiness — CSV import wizard, onboarding/empty-state polish for non-founder users (D-017); dashboards, batch approvals, policy editor, PWA polish, cmd-k, dark mode.
- **P3:** change studio, visual workflow editor, simulation/shadow result views.

## Playground (D-025 — component gallery, not a module playground)

casper-web is the product frontend, so it has no "module playground" in the D-025 sense. What may be worth building — once the components stabilize — is a small **component gallery** (Storybook-shaped, a different tool from the playground host) for the shared UI that deserves isolated iteration: above all the **change-diff viewer** (field before/after, risk badges, stale markers — the trust UI), plus the AI dock surfaces and error/empty/loading states, against fixture data. Optional and independent of the playground host; full-page flows are developed in the app itself.

## Open questions

- Realtime for collaborative presence (others editing the same record): defer or cheap version via polling? (Default: defer; single-team MVP rarely collides — revisit with usage.)

## Success criteria

- Phase-1 happy-path e2e green: full assistant cycle from request to committed changes entirely through the UI.
- A user can run their day (pipeline, tasks, approvals) from a phone browser without pinch-zooming.
- Manual paths exist and are ≤ as many clicks as pre-AI CRMs for the top 10 actions (status change, task add, field edit, etc.).
- Lighthouse perf ≥ 85 on records list and record detail at MVP data scale.
