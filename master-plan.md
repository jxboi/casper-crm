# Casper CRM — Master Plan

**Version:** 0.9 &nbsp;|&nbsp; **Date:** 2026-07-16 &nbsp;|&nbsp; **Stage:** **Phase 0 complete**; Phase 1 engine (records, workflow, changesets), casper-sales P1a, casper-web dogfood UI, and casper-ai P1b run engine are built. Next frontier: Phase 1 durability/budgets and dogfood hardening.

> Source references: [adaptive-crm-workflow-platform-summary.md](adaptive-crm-workflow-platform-summary.md), [ai-strategy.md](ai-strategy.md).
> Those documents are the vision input. **This file is the source of truth for cross-module decisions.** Each module folder contains a `plan.md` that must stay aligned with this file (see §10 Alignment Protocol).

---

## 1. Vision

An AI-native CRM that behaves like a governed operating environment for human and AI work — not a CRM with a chatbot bolted on.

Two capabilities, one platform:

1. **Operational assistance** — every user has a permissioned AI colleague that prepares real work (follow-ups, updates, drafts) which humans review and commit.
2. **Workflow evolution** — the product detects friction, workarounds, and feedback, and turns them into safe, testable, measurable workflow changes.

Positioning: *"The CRM that evolves with the way your team actually works."*

## 2. Strategy: product-first, engine-aware

The reference doc is explicit: **do not build a generic platform first.** We build one product (Sales CRM + one sales assistant), but we draw the engine/product boundary from day one because it is nearly free to do so and expensive to retrofit:

- **Engine modules** (records, workflow, change sets, AI framework, events) contain zero sales-specific logic.
- **Product modules** (`casper-sales`) contain only configuration, prompts, and product glue.
- We generalize engine capabilities **only when the first product proves them**. Product #2 (recruitment / service desk / onboarding) is explicitly out of scope until the first product has meaningful adoption.

The three architectural bets that differentiate this product (everything else is table stakes):

1. **Change sets as the universal mutation primitive** — AI work and admin workflow changes both flow through draft → preview → approve → commit → rollback.
2. **Unified principal model** — AI assistants are governed principals in the *same* permission system as humans, enforced by the platform, not by prompts.
3. **Event backbone as the nervous system** — every mutation and meaningful interaction becomes an event; audit, timeline, automations, and the feedback/evolution loop are all consumers.

## 3. Architecture overview

Modular monolith. One TypeScript monorepo, modules as workspace packages, deployed as a **single Vercel project** (D-019) sharing one Neon Postgres database — user-facing routes and durable background workflows are two surfaces of the same deployment, not separate services. No microservices until a specific module proves it needs extraction.

```mermaid
graph TD
    subgraph Application
        WEB[casper-web · Next.js UI]
        API[casper-api · server runtime, jobs, public API]
    end
    subgraph Product
        SALES[casper-sales · Sales CRM definition + sales assistant]
    end
    subgraph AI
        AI[casper-ai · assistants, runs, tools, policies]
        FB[casper-feedback · feedback, signals, proposals]
    end
    subgraph Engine
        REC[casper-records · objects & fields]
        WF[casper-workflow · stages, transitions, automations]
        CS[casper-changesets · draft/diff/approve/commit]
        COMMS[casper-comms · email integration]
    end
    subgraph Foundation
        AUTH[casper-auth · identity, tenancy, permissions]
        EV[casper-events · event bus, audit, timeline, notifications]
        PLAT[casper-platform · db, jobs, config, crypto, observability]
    end

    WEB --> SALES & AI & REC & WF & CS & FB & COMMS
    API --> AI & WF & EV & COMMS
    SALES --> REC & WF & AI
    AI --> CS & REC & WF & AUTH & EV
    FB --> EV & CS & WF
    CS --> REC & WF & EV
    COMMS --> REC & EV & CS
    REC --> AUTH & EV & PLAT
    WF --> REC & EV & PLAT
    EV --> PLAT
    AUTH --> PLAT
```

## 4. Module registry

| Module | Layer | Purpose | First active phase | Depends on |
|---|---|---|---|---|
| [casper-platform](casper-platform/plan.md) | Foundation | Shared kernel: DB, migrations, jobs, config, crypto, flags, observability | 0 | — |
| [casper-auth](casper-auth/plan.md) | Foundation | Identity, orgs/workspaces/teams, roles, unified principal model, `can()` | 0 | platform |
| [casper-events](casper-events/plan.md) | Foundation | Domain + interaction events, audit log, record timeline, comments, notifications | 0 | platform, auth |
| [casper-records](casper-records/plan.md) | Engine | Record types, fields, relations, validation, views/filters/search, import/export | 0 | platform, auth, events |
| [casper-workflow](casper-workflow/plan.md) | Engine | Stage models, transitions, assignment/SLA rules, automations, versioning, simulation | 1 | records, events |
| [casper-changesets](casper-changesets/plan.md) | Engine | Transactional workspace: draft ops, diff, validate, approve, commit, rollback | 1 | records, workflow, events |
| [casper-ai](casper-ai/plan.md) | AI | Assistant registry, run engine (work cycle), tool framework, risk & approval policies, model gateway | 1 | auth, records, workflow, changesets, events |
| [casper-feedback](casper-feedback/plan.md) | AI | Contextual feedback, workaround signal detection, clustering, change proposals, outcome measurement | 1 (capture) / 3 (loop) | events, changesets, workflow |
| [casper-comms](casper-comms/plan.md) | Engine | Email: drafts (P1), OAuth send (P2), ingestion & extraction (P3+), calendar (P4) | 1 | records, events, changesets |
| [casper-sales](casper-sales/plan.md) | Product | Sales CRM product definition: types, pipeline, views, automations, sales assistant, seed data | 1 | records, workflow, ai |
| [casper-web](casper-web/plan.md) | Application | Next.js app: CRM UI, AI surfaces, approvals inbox, admin, feedback widget | 0 | all modules |
| [casper-api](casper-api/plan.md) | Application | Server runtime: job workers, AI run executor, SSE streaming, cron, public API (P4) | 0 | all modules |

Future modules (folders **not** created yet — do not build ahead of need): `casper-billing` (subscriptions/metering), `casper-integrations` (webhooks marketplace, Slack/Teams), `casper-mobile` (PWA companion), product #2.

Dev tooling (not domain modules): `tooling/playground` (playground host) and `tooling/playground-kit` per D-025 — no domain logic, never deployed; plan at [tooling/playground/plan.md](tooling/playground/plan.md).

## 5. Cross-cutting decisions (Decision Log)

Append-only. Module plans cite these by ID. Superseding a decision requires a new entry, not an edit.

- **D-001 — Modular monolith in a TypeScript monorepo.** pnpm workspaces + Turborepo. Each `casper-*` folder is a workspace package (apps: `casper-web`, `casper-api`). Modules interact only through their exported public API — no reaching into another module's tables or internals. Enforced later by lint rules (`eslint-plugin-boundaries` or similar).
- **D-002 — Postgres is the single source of truth.** Neon Postgres, Drizzle ORM. Each module owns its schema/migrations; a central runner applies them. Tenant isolation via `org_id` (+ `workspace_id`) columns on every domain table, with Postgres RLS enabled as defense-in-depth (session variables set by the platform tenancy context). No second datastore in MVP (no Redis, no vector DB).
- **D-003 — Tenancy model:** Organization → Workspaces → Teams → Users. Membership and roles are workspace-scoped with org-level roles above. Every domain entity carries `orgId` + `workspaceId`.
- **D-004 — Unified principal model.** `Principal = user | assistant | api_key | system`. One authorization API — `can(principal, action, resource, ctx)` — implemented in casper-auth and called by every module and every AI tool. AI assistants are first-class principals with scoped permissions, field-level masks, and budgets. Permissions are enforced by the platform, never inferred by the model.
- **D-005 — Event backbone with transactional outbox.** Every domain mutation emits a typed event in the same DB transaction; a dispatcher fans out to consumers (at-least-once; handlers idempotent). Two streams: **domain events** (facts, long retention) and **interaction events** (UI telemetry for the feedback loop, sampled, shorter retention). Audit log and record timeline are projections of events.
- **D-006 — Change sets are the universal mutation primitive for risky changes.** Medium/high-risk mutations (AI-proposed work, workflow config publishes, bulk edits) go through: draft ops → validate → preview diff → approve (full or selective) → commit → optional rollback (compensating change set). Low-risk direct writes (a user editing a field in the UI) bypass change sets but still emit events. AI mutation tools can *only* write into change sets — "zero unapproved mutations" is guaranteed by construction, not by prompt.
- **D-007 — Platform-wide risk taxonomy.** Three classes with default action mapping (overridable per org): **low** = read/search/summarize/draft/report; **medium** = create tasks, update ordinary fields, ownership/date changes, normal stage transitions; **high** = external sends, deletes, permission changes, financial fields, workflow publishes, irreversible actions. Approval policies per assistant × action class: `always_allow` / `allow_within_limits` / `batch_review` / `require_every_time` / `never`. Policies can narrow but never silently widen permissions.
- **D-008 — Tool-mediated AI only.** The model never touches the DB or generates SQL. Tools are typed contracts that validate tenant scope, permissions, risk, and budgets on every call. **Committing an approved change set is not a model-callable tool** — it is a platform action triggered by human approval (refinement of the reference doc, which listed `commit_approved_changes` as a tool).
- **D-009 — Models: Anthropic Claude.** Default agent-loop model `claude-opus-4-8` ($5/$25 per MTok, 1M context) with adaptive thinking + SDK tool runner. High-volume classification/clustering (risk pre-screens, feedback grouping, intent detection): `claude-haiku-4-5` ($1/$5). Cost-tuning middle tier if evals justify it: `claude-sonnet-5` ($3/$15; intro $2/$10 to 2026-08-31). `claude-fable-5` ($10/$50) reserved behind a flag for the hardest planning tasks if ever needed. Every run logs model ID + prompt version; budgets tracked per assistant/org/day.
- **D-010 — UI stack.** Next.js (App Router) + Tailwind + shadcn/ui. Responsive web first; mobile browser must be good for *acting* (approvals, tasks, quick updates, notifications). Four persistent AI surfaces: **Conversation, Plan, Workspace, Changes**. Every AI-supported action has a one-click manual equivalent.
- **D-011 — Jobs on Postgres.** pg-boss queue in the server runtime (casper-api). Long AI runs execute in the worker, stream progress as run events persisted to DB, delivered to the browser over SSE. No Redis until scale demands it.
- **D-012 — Data conventions.** IDs: UUIDv7. Timestamps: `timestamptz` UTC. Money: integer minor units + ISO 4217 currency code. Event names: `<entity>.<verb_past_tense>` (e.g. `deal.stage_changed`). Record references: `{ type: <recordTypeKey>, id: <uuid> }`.
- **D-013 — Records storage model.** Typed field registry per record type; values in a JSONB `data` column with GIN index; hot fields promoted to generated columns when query patterns demand. Validation schemas (zod) compiled from field definitions — the *same* validation path serves direct writes and change-set commits. System record types (Task, Note, Attachment) defined in code; product types (Contact, Company, Deal) seeded as versioned config by product modules.
- **D-014 — Workflow evaluation is pure.** `evaluate(definitionVersion, record, event, now) → effects[]` with no I/O; the runner executes effects. Purity is what makes historical simulation and shadow mode (Phase 3) cheap. Workflow definitions are immutable versions; records stamp the version they entered under; publishing a new version is a change-set operation (preview + one-click rollback).
- **D-015 — Hosting (initial).** Web on Vercel; `casper-api` (API + worker) on Railway or Fly.io; Neon Postgres; blobs on Cloudflare R2 (or Vercel Blob); system email via Resend. Revisit at end of Phase 0 — cheap to change before launch.
- **D-016 — Security & compliance baseline.** Tenant-isolation tests in CI (cross-tenant access attempts must fail); OAuth tokens and secrets sealed with platform crypto; PDPA-aware: org-level data export & deletion, configurable retention for events/audit; prompt-injection stance: **all CRM content (records, emails, feedback text) is untrusted data, never instructions** — tool results are structured and delimited, and assistant instructions come only from versioned prompt packs and platform context.
- **D-017 — Adoption path: dogfood → design partners → self-serve.** Phase 1 is built for the founder running his own real pipeline daily (dogfood). Design-partner readiness — multi-user polish, CSV import, PDPA enforcement checkpoint — is Phase 2 entry work. Self-serve comes later. Phase exit criteria are phrased accordingly.
- **D-018 — Web↔module layer is tRPC.** tRPC routers live in casper-web's server layer; procedures are thin wrappers over module public APIs (no business logic in routers). casper-api's roles (SSE streaming, jobs, public REST in P4) are unchanged. Resolves Q-4.
- **D-019 — Vercel-first infrastructure (supersedes D-015; amends D-011).** Founder familiarity wins: everything runs on Vercel. **One Vercel project** — the Next.js app — hosts the UI, tRPC, run-stream/SSE route handlers, **Vercel Cron** endpoints, and **Workflow DevKit (WDK)** durable workflows; a second Vercel project is the escape hatch if build times or blast radius ever demand a split. Long/multi-step work (AI runs, event fan-out, imports, mailbox sync, measurement/retention) runs as WDK workflows: durable per-step retries, `createHook`/`resumeHook` suspensions for human-approval pauses (zero compute while waiting), resumable namespaced output streams. Ordinary long requests ride Fluid Compute (300s default / 800s max on Pro; Active-CPU pricing bills almost nothing while awaiting model responses). **pg-boss is dropped** (it needs a persistent poller); the transactional outbox (D-005) stays, drained by post-commit `waitUntil` triggers plus a sweeper cron for at-least-once delivery. D-011's no-Redis stance stands. Rest of stack: Neon via Vercel Marketplace (+ `@neondatabase/serverless` pooling), **Vercel Blob**, Flags SDK + Edge Config (global flags; org-scoped targeting stays in Postgres), Vercel Observability + log drains, Vercel WAF for coarse edge rate limits, Vercel git integration for CI + preview deployments. Resolves Q-2.
- **D-020 — Access model v1: open read, scoped write.** Every workspace member can read all records in their workspace — no per-record visibility machinery in MVP. Sensitive fields are readable by all members by default: sensitivity raises *edit* risk (D-007) and caps assistants; human read-masks are opt-in per role (P2+). Writes follow role grants (`own` / `team` / `workspace` scope). **Teams are a write-permission boundary:** a record belongs to every team its owner is in (derived — no `team_id` on records); users may belong to multiple teams and team-scoped grants union across them — an actor may team-write a record iff they share ≥ 1 team with its owner. Built-in roles: Org Owner, Org Admin, Workspace Admin, Manager, Member — **Guest is cut** until a concrete need appears; external/record-scoped sharing is a future feature.
- **D-021 — Configurable manager model.** Org setting `managerModel: 'workspace' | 'team_lead' | 'reporting_line'`, default `workspace`. The knob exists in the data model from day one; implementations phase in: workspace-wide only in P0/P1 → team-lead in P2 → reporting-line P3+. "Owner's manager" (e.g. the casper-sales lost-deal notification) resolves per the configured model; under `workspace` it means all Manager-role holders in the workspace.
- **D-022 — Assistant permissions are capped by the owner (refines D-004).** A personal assistant's effective permissions = its registry scope ∩ its owning user's permissions, evaluated inside `can()` at decision time. The assistant can never read or propose anything its owner couldn't do directly; role demotions and field masks propagate automatically with no assistant-grant edits.
- **D-023 — Permission mutations are human-direct, AI-never.** Human admin actions on members/roles/grants (invite, role change, removal, grant edits) are direct writes — `can()`-gated and fully audited via events, never change-setted. D-007's "permission changes = high risk" classification exists to keep these actions off-limits to AI: the assistant approval policy for permission actions is `never`. Clarifies the D-006/D-007 boundary (change sets govern AI work, config publishes, and bulk edits — not admin member management).
- **D-024 — Offboarding: deactivate + manual reassign.** Deactivating a membership blocks login, revokes sessions, suspends the user's personal assistant, flags their pending authored change sets for review, and revokes their OAuth mail tokens (P2+, casper-comms). Owned records keep ownership until an admin reassigns them (admin UI offers bulk "reassign all to X"). No hard deletes of users; PDPA deletion (D-016) operates at org level.
- **D-025 — Per-module dev playgrounds (opt-in pattern).** A module MAY ship a dev-only playground surface in its own folder (`casper-<module>/playground/`, exported as `@casper/<module>/playground`): React pages/scenarios exercising its public API in isolation, mounted one at a time by a dev-only Next.js **playground host** (`tooling/playground/`, `pnpm play <module>`) over a shared **playground kit** (`tooling/playground-kit/`: dev principal switcher exercising `can()`/D-022, JSON/diff viewers, event tail, dev-context bootstrapper for dev org/workspace/principals + optional casper-sales seed). This is an available pattern, **not a per-module requirement** — a playground earns its place only where a module's internals are rich and lack a natural UI early; a blanket "every module gets one" is explicitly rejected as over-build for a solo founder (§11 bandwidth risk; "don't build ahead of need"). **Committed initial set:** casper-auth (`can()` explorer) and casper-records (Filter AST builder) in Phase 0 alongside the host/kit; casper-workflow (pure `evaluate()` scratchpad) and casper-ai (run/tool inspector) in Phase 1. **All other modules opt in** only on demonstrated need — casper-events (event tail) and casper-changesets (diff/approve) are the strongest remaining candidates; casper-platform, casper-sales, and casper-api overlap with the test kit / seeded-config composition / `npx workflow inspect` and default to none. casper-web is not a module playground but a component gallery (a different, Storybook-shaped tool). Guarantees when a playground exists: never deployed (no Vercel project); kit refuses non-dev databases and production; playground exports importable only by the host (boundary lint per D-001); surfaces import only their own module's public API + the kit. **Alternative considered:** a gated `/dev` area inside casper-web instead of a separate host — lighter, but gives up cross-module build isolation (low value for a solo dev); retained as the fallback if the host/kit proves heavier than its payoff. Internals: [tooling/playground/plan.md](tooling/playground/plan.md).

- **D-026 — Emission context + changesets→workflow direction (P1b).** Two refinements landing with the workflow automation engine + change-set publishing. **(a) `ConfigRef` is defined** (§6) as the target of a `config_publish` change and the subject of config-versioning events — it was referenced but never specified. **(b) An ambient *emission context* in casper-events** (`withEmissionContext({ causationId?, source? })`) lets a caller stamp `causationId`/`source` on every `emit()` in a dynamic scope without threading them through every write-path signature; `emit()` reads it only as a fallback (explicit `EmitInput` wins; no scope = prior behavior). This is what makes change-set commits attributable (`causationId = changeset`) and automation effect-events walkable for loop protection (`source: 'automation'` + a causation chain), with zero changes to `createRecord`/`updateRecord`/`transition`. **(c) Dependency direction `casper-changesets → casper-workflow`** (one-way): workflow exposes config primitives (`applyConfigPublish`, `diffWorkflow`, version lookups); changesets owns the publish lifecycle and calls into workflow on commit. Workflow never imports changesets — avoids a cycle while honoring "commit applies through module write APIs" (D-006). Automations run under the **system principal** (trusted, admin-authored config), like the SLA scan.

## 6. Shared contracts

These shapes cross module boundaries. Changing any of them requires a master-plan version bump (§10).

```ts
// Principal — who is acting (casper-auth)
type Principal = {
  kind: 'user' | 'assistant' | 'api_key' | 'system';
  id: string;                       // uuid of user / assistant / key
  orgId: string;
  workspaceId?: string;
};

// Authorization — the single gate (casper-auth)
can(principal, action: string, resource: ResourceRef, ctx?): Promise<Decision>
// action strings: 'record.read' | 'record.update' | 'record.transition' |
// 'record.field.write:<fieldKey>' | 'changeset.approve' | 'workflow.publish' | ...

// Record reference (casper-records)
type RecordRef = { type: string; id: string };           // e.g. { type: 'deal', id: '...' }

// Config reference (casper-workflow / casper-records config) — the target of a
// `config_publish` change and the subject of config-versioning events (D-026).
type ConfigRef = {
  kind: 'config';
  configType: 'workflow' | 'automation' | 'field';
  recordType?: string;                                   // e.g. 'deal' for a workflow config
  version?: number;                                      // the version being published/targeted
};

// Event envelope (casper-events)
type DomainEvent = {
  id: string;                        // uuidv7
  orgId: string; workspaceId: string;
  type: string;                      // 'deal.stage_changed'
  subject: RecordRef | ConfigRef;
  actor: Principal;
  source: 'ui' | 'api' | 'automation' | 'ai' | 'system';
  payload: unknown;                  // versioned per event type (schemaVersion)
  occurredAt: string;
  correlationId: string; causationId?: string;
};

// Risk classes (D-007)
type Risk = 'low' | 'medium' | 'high';

// Change set (casper-changesets)
type ChangeSet = {
  id: string; orgId: string; workspaceId: string;
  author: Principal;
  origin: 'ai_run' | 'manual' | 'feedback_proposal' | 'workflow_publish';
  title: string; intent?: string;
  status: 'draft' | 'in_review' | 'approved' | 'committing' | 'committed' | 'rejected' | 'rolled_back';
  changes: Change[];
  artifacts: Artifact[];             // drafts, generated files
};
type Change = {
  id: string;
  op: 'create' | 'update' | 'delete' | 'transition' | 'config_publish';
  target: RecordRef | ConfigRef;
  payload: unknown;                  // op-specific
  baseVersion: string;               // conflict detection
  risk: Risk;
  approval: 'pending' | 'approved' | 'rejected';
  validation: { ok: boolean; issues: Issue[] };
};

// AI tool contract (casper-ai)
type ToolDef<I, O> = {
  name: string; description: string;
  inputSchema: ZodSchema<I>;
  risk: Risk;
  requiredPermissions: string[];
  execute(ctx: ToolCtx, input: I): Promise<O>;   // ctx carries principal, changeset, limits
};

// Filter AST (casper-records) — shared by saved views, automation conditions, assistant queries
type Filter = { field: string; op: 'eq'|'neq'|'in'|'gt'|'lt'|'contains'|'is_empty'|'within_last'|...; value: unknown }
            | { and: Filter[] } | { or: Filter[] } | { not: Filter };
```

## 7. Roadmap

Phases match the AI-strategy rollout. A phase is done when its **exit criteria** pass, not when its code merges.

### Phase 0 — Foundations (walking skeleton)
Modules: platform, auth, events, records (core), web (shell), api (runtime skeleton).
Build: monorepo scaffold; multi-tenant auth (sign-up, org/workspace, invites, roles); record engine with system Task type + one placeholder product type; event outbox + audit log + timeline; deployed to real infra with CI; playground host + kit with the initial `can()` (auth) and Filter-AST (records) surfaces (D-025).
**Exit criteria:** two orgs can sign up and cannot see each other's data (verified by automated cross-tenant tests); creating/updating a record produces an audit entry and timeline item; deployed web + api + db with CI; `can()` gate used by every write path.

**Phase 0 closure — verified 2026-07-16.** Two production Better Auth signups created distinct org/workspace memberships in Neon; a live record written as org A was invisible as org B and produced both `task.created` audit and timeline projections. The single Vercel deployment exposes web, auth/API, health, and WDK endpoints; the daily Hobby-compatible cron starts a durable 24-hour loop with one-minute outbox sweeps, and a production workflow run completed successfully. CI runs frozen install → typecheck → tests → build; the closure suite is 63 tests across 12 typechecked packages. Public Phase 0 mutators are context-bound and `assertCan()`-gated; seed/provisioning bypasses are isolated to `@casper/auth/testkit`. The dev-only playground host boots the auth `can()` explorer and records Filter-AST builder via `pnpm play <module>` and is excluded from deployment.

### Phase 1 — Sales CRM + narrow assistant MVP (dogfood, D-017)
Modules: sales, workflow (v1), changesets (v1), ai (v1), comms (drafts only), feedback (capture only), web (CRM UI + AI surfaces + approvals). Split into three sequenced milestones — CRM fundamentals first, then the assistant:

**Phase 1a — Dogfood CRM (fundamentals first).**
Build: Contact/Company/Deal + pipeline workflow (stages, transitions, SLA/neglect rules); views (table, board), tasks, timeline UX; seed-data script (demo dataset + a founder-pipeline variant).
**Exit criteria:** the founder abandons his current tool and runs his real pipeline here daily.

**Phase 1b — M1 "first follow-up" demo slice.**
Build: change sets v1; AI run engine with the **M1 tool subset** (7 tools — defined in casper-ai plan); AI dock (all four surfaces, minimal polish); approvals flow; email *drafts* as artifacts.
**Exit criteria:** full request → clarify → plan → preview diff → approve/selective-approve → commit cycle on the founder's own pipeline, fully audited; **zero mutations occur without approval** (enforced + audited).

**Phase 1c — Assistant hardening.**
Build: full ~10-tool set (adds transitions, workflow reads, clarification tool); feedback widget capturing context; notification email delivery; admin v1.
**Exit criteria (= MVP definition, §8):** the founder runs pipeline *and* follow-up work through the product daily; assistant proposals (tasks + field updates + email drafts) are approved/rejected via record-level diffs; every AI action has a manual equivalent; full audit trail per run.

### Phase 2 — Safety & policy depth
Modules: ai, changesets, auth, comms, web, sales (dashboards).
Build: **design-partner readiness (D-017 gate): CSV import + dedupe, multi-user onboarding polish, PDPA/retention enforcement checkpoint;** standing approval policies (allow-within-limits, batch review) with hard budget caps; selective/batch approvals UX; conflict detection + stale-change re-review; one-click rollback (compensating change sets); assistant budgets (tokens/$/records/day); Gmail send via **test-mode OAuth for dogfooding** + Microsoft OAuth **send-on-approval** (start Google restricted-scope verification once design partners commit); persistent AI workspaces; AI eval harness (golden tasks, plan-approval-rate); dashboards; PWA + mobile approval polish.
**Exit criteria:** a user can safely leave "always allow within limits" on for low-risk actions for a week without surprises; rollback works on real committed change sets; conflicting concurrent edits are detected, never clobbered; measured plan-approval and change-acceptance rates ≥ agreed thresholds.

### Phase 3 — Workflow evolution loop
Modules: feedback (full), workflow (simulation + shadow + gradual rollout), changesets, web (change studio).
Build: workaround signal detectors (exports, repeated manual patterns, stage skips, field churn, stage dwell); clustering into themes (haiku); structured ChangeProposal objects (problem → evidence → proposed rule/workflow edit → impact estimate → pilot → success metric); historical simulation against past events; shadow mode; pilot rollout scoping (team/percentage); post-change outcome measurement; the shared "change studio" view tying feedback → proposal → simulation → rollout → metrics.
**Exit criteria:** at least one workflow improvement goes end-to-end: detected/reported → proposed → simulated → piloted → measured → adopted or reverted, entirely inside the product.

### Phase 4 — Expansion
Modules: comms (inbound sync + extraction, calendar), api (public REST + webhooks), sales (templates), second assistant (onboarding *or* service — pick from real demand), integrations groundwork.
**Exit criteria:** email ingestion auto-associates threads to records and proposes updates through change sets; public API v1 with API keys + webhooks; industry template applied to a fresh org in < 15 minutes.

## 8. MVP definition (end of Phase 1)

Mirrors the AI-strategy MVP scope. **In:** responsive web app; overdue/neglected-opportunity workflow; workspace membership + RBAC; one personal sales assistant; 5–10 controlled tools; full request→commit cycle; transactional change-set workspace; task / field-update / email-draft proposals; record-level diff preview; selective and all-or-nothing approval; complete audit trail; manual equivalent for every action; basic metrics/logging/error monitoring.
**Deferred:** CSV import + dedupe (Phase 2 — design-partner prerequisite; dogfood uses seed data per D-017); autonomous external communication, multi-agent orchestration, universal workflow generation, additional industry products, integration marketplace, native mobile apps, automatic workflow rewriting, high-risk financial/destructive automation.

## 9. Metrics (product-level)

Tracked from Phase 1 via casper-events; dashboards in Phase 2. Full list in ai-strategy.md §Metrics — headline set:

- **Value:** time saved per workflow; manual actions removed; follow-up completion; approval turnaround; workflow cycle time; reduction in export/chat workarounds.
- **AI quality:** run completion rate; plan approval rate; change acceptance rate; user edit rate; rejection/rollback rate; tool error rate.
- **Trust:** unapproved mutations (**target: zero, by construction**); permission-denial correctness; external-send approval compliance; audit completeness.
- **Adoption:** weekly active AI users; repeat AI usage; share of eligible work initiated via AI; pilot→paid conversion; retention.
- **Dogfood (Phase 1, D-017):** founder daily-use streak; % of eligible actions initiated via the assistant (from 1b); weekly "did I reach for the old tool or a spreadsheet?" check.

## 10. Alignment protocol (how plans stay in sync)

1. **Ownership.** master-plan.md owns: decisions (D-xxx), shared contracts (§6), module registry, phases/exit criteria. Each `plan.md` owns its module's internals.
2. **Headers.** Every `plan.md` starts with: `Status | Layer | Phases | Depends on | Used by | Aligned with master-plan vX.Y`.
3. **Promotion rule.** Anything that crosses a module boundary (new shared type, new dependency edge, new cross-module behavior) must be promoted here as a decision or contract *before* module plans rely on it.
4. **Ripple rule.** When this file changes in a way that affects modules: bump the version, note it in the changelog (§13), and update every affected `plan.md` (content + `Aligned with` header) **in the same working session**. No orphaned misalignment.
5. **Living documents.** When implementation deviates from a plan, the plan is updated in the same PR. A plan that disagrees with shipped code is a bug.
6. **Open questions** are tracked in §12 with an owner and a decide-by phase; module plans may list local open questions.

## 11. Top risks

| Risk | Mitigation |
|---|---|
| Building a generic platform instead of a product | Phase gates; engine features only enter when casper-sales needs them; product #2 forbidden until adoption |
| AI harms trust (bad or unsafe mutations) | D-006/D-007/D-008: change-set-only mutations, risk-gated approvals, budgets, full audit, rollback |
| Prompt injection via CRM content | D-016 stance; tools return structured data; injection test suite in AI evals |
| Google restricted-scope (Gmail) verification takes months | Start CASA process at Phase 2 start; product fully usable draft-only; Microsoft Graph path in parallel |
| Approval fatigue → users disable safety | Risk-proportional policies, batching, within-limits standing approvals with hard caps (Phase 2 focus) |
| AI cost blowout | Per-assistant/org budgets, haiku for high-volume classification, cost per run tracked from day one |
| Solo-founder bandwidth | Modular monolith on a single Vercel project (D-019 — founder's home turf), Postgres-only data infra, boring technology everywhere except the three bets (§2) |
| Workflow DevKit is new | P0 spike validates local dev + testing story before the AI run engine commits to it; fallback documented in casper-api plan (Fluid functions + outbox-table job runner) |
| Tenant data leakage | RLS + `can()` on every path + CI cross-tenant tests (Phase 0 exit criterion) |
| Dogfooding blindness (building for self ≠ market) | D-017 design-partner gate at Phase 2; discovery interviews continue through Phase 1; founder captures his own friction via the feedback widget like a real user |

## 12. Open questions

| # | Question | Owner | Status / decide by |
|---|---|---|---|
| Q-1 | Auth provider | casper-auth | **Resolved v0.2:** better-auth; GitHub OAuth is the primary login for dogfood (+ email/password); Google OAuth + magic link before design partners (P2) |
| Q-2 | Hosting for the server surface | casper-platform | **Resolved v0.3:** all-Vercel (D-019) — no Railway/Fly; WDK + Cron + Fluid Compute replace the standalone worker service |
| Q-3 | Can a user approve a high-risk change set they authored? (default: no, for orgs > 1 seat) | casper-changesets | **Resolved v0.4:** no — a human-authored high-risk change set requires a different approver holding `changeset.approve`; single-seat orgs (dogfood) exempt. AI-authored change sets approved by the requesting user are review, not self-approval — unaffected |
| Q-4 | Web↔module call layer | casper-web | **Resolved v0.2:** tRPC (D-018) |
| Q-5 | Product name ("Casper" is a codename) | founder | Pre-launch |
| Q-6 | Pricing model & billing module timing | founder | **Deferred v0.2** past Phase 2 (dogfood first, D-017); revisit Phase 3 |
| Q-7 | Mailbox provider priority | casper-comms | **Reframed v0.2:** dogfood uses Gmail in Google **test mode** (unverified app, ≤100 test users — no CASA needed); verification decision deferred until design partners are known; Microsoft-first remains the fallback |

## 13. Changelog

- **v0.8 (2026-07-15)** — **casper-ai P1b run engine built** (`@casper/ai`): assistant registry (definitions as config-data, registered by product modules), the run engine (runs persisted to `ai_runs` + every model turn / tool call to `ai_run_steps` — the audit source of truth), the model gateway (Anthropic SDK, `claude-opus-4-8` + adaptive thinking, prompt-cached system stance, per-run token/cost accounting off the D-009 pricing table), and the **M1 7-tool set** behind a single `runTool` gate: allowlist → policy matrix → zod → `can()` — authorized against the **owner**, not the assistant (D-022) → execute → step log, with `ai.tool_denied` events on refusal. Propose tools write only into the run's change set (D-006/D-008); the run ends at `preview_ready` with a submitted change set — approval/commit stay human actions in casper-changesets. **casper-sales** ships the Sales Follow-up Assistant as data (P1b content; plan's "not started" superseded). **casper-web** gets the real SSE origin: `POST /api/ai/run` streams `RunEvent`s; the dock's conversation/plan surfaces render live model text, tool calls, plan steps, and email-draft artifacts — pacing theatre retired. **Deviations flagged:** the loop runs **in-process** in the route handler for the dogfood slice (WDK durability, D-019, deferred to P1c); the plan object is a static placeholder (no `awaiting_plan_approval`/`clarifying` engine states — the clarify step is scripted in the dock pre-run); budgets are declared on the assistant def but **not yet enforced** (only a max-iterations cap); `dataBlock()` (D-016 stance helper) is exported but unused in the M1 loop (tool results are structured JSON); **casper-ai has no tests yet** — the "no path from model output to a committed write" safety criterion is asserted by construction but unverified by test. Ripples: casper-ai plan (P1b built + deviations), casper-sales plan (assistant shipped), casper-web plan (SSE live), README, IMPLEMENTATION.md.
- **v0.7 (2026-07-14)** — First **product** + **application** code. **casper-sales P1a** ships the Sales CRM as configuration only (Contact/Company/Deal types, the `New→…→Won|Lost` pipeline with guards, neglect SLA rules, default automations + views, an idempotent seed runner) over the existing engine — **zero engine changes**, proving the engine/product split. **casper-web** gets its first real wiring (D-018): the whole monolith runs in-process (PGlite) behind a Server-Functions BFF, and the Pipeline board, deal detail, and Deals/Companies/Contacts list views render + mutate real data through the workflow guards → `can()` → records write path → events. Deviations flagged for follow-up: Server Functions instead of tRPC for now; `next dev --webpack` + a `.js`→`.ts` extensionAlias; manager-only deal re-open needs a `record.reopen` action; a future-facing date operator for "Closing this month"; category-scoped SLA. Ripples: casper-sales plan (P1a built), casper-web plan (first wiring), README, IMPLEMENTATION.md. A follow-up increment wired the **AI dock's neglected-deals read** and the **approval flow (dock Changes tab + Approvals inbox) onto the real `casper-changesets` module** (D-006): runs stage real change sets, per-change approve/reject and commit go through the engine, `causationId = changeset` on every applied event — nothing mutates a record until commit. Added `listChangeSets` (workspace-scoped, status-filterable) to the changesets public API. Still unwired: feedback widget, conversation/plan SSE pacing (D-019), login (single dev principal).
- **v0.6 (2026-07-13)** — **D-026** (workflow P1b): defined the missing **`ConfigRef`** shared contract (§6 — target of a `config_publish` change, subject of config events); added the casper-events **emission context** (`withEmissionContext`) so change-set commits stamp `causationId = changeset` and automation effects stamp `source: "automation"` + a causation chain without new write-path params; fixed the dependency direction **casper-changesets → casper-workflow** (workflow exposes `applyConfigPublish`/`diffWorkflow`; changesets owns the publish lifecycle). Ripples: casper-workflow plan (P1a+P1b built), casper-changesets plan (P1 built), IMPLEMENTATION.md. Stage header updated to reflect code now exists (records/workflow/changesets engines built + tested).
- **v0.5 (2026-07-11)** — Per-module dev playgrounds as an **opt-in** pattern (D-025): a dev-only playground host (`tooling/playground`, `pnpm play <module>`) + shared kit mount one module's `playground/` surface at a time. Committed initial surfaces: casper-auth (`can()`) and casper-records (Filter AST) in P0, casper-workflow (`evaluate()`) and casper-ai (run/tool inspector) in P1; every other module opts in only on demonstrated need. Blanket per-module playgrounds rejected as over-build (solo-founder bandwidth); `/dev`-in-web noted as the lighter fallback. `tooling/` packages noted in the registry (not domain modules). Ripples: all 12 module plans (committed surfaces detailed; others marked deferred candidates) + new tooling/playground plan.
- **v0.4 (2026-07-11)** — Users/teams/permissions refinement session with founder. Added D-020 (access model v1: open read / role-scoped write, teams as write boundary, owner-derived record→team mapping, multi-team union rule, sensitive fields readable by default, Guest role cut), D-021 (configurable manager model — workspace | team_lead | reporting_line, phased), D-022 (assistant permissions capped by owner), D-023 (permission mutations human-direct + audited, AI-never), D-024 (offboarding: deactivate + manual reassign). Q-3 resolved (no self-approval of human-authored high-risk change sets in multi-seat orgs). Ripples: casper-auth (major), casper-records, casper-ai, casper-changesets, casper-sales, casper-web.
- **v0.3 (2026-07-11)** — Vercel-first infrastructure per founder preference (D-019, supersedes D-015 / amends D-011): single Vercel project; Workflow DevKit for AI runs (per-turn durable steps, `createHook` approval pauses, resumable streams) and all background work; Vercel Cron; outbox drained via `waitUntil` + sweeper cron (pg-boss dropped); Neon via Marketplace, Vercel Blob, Flags SDK/Edge Config, Vercel Observability + WAF. Q-2 resolved (no Railway/Fly). WDK-maturity risk added with P0 spike + fallback. casper-api redefined as the in-project server surface, not a standalone service.
- **v0.2 (2026-07-11)** — Refinement session with founder. Added D-017 (dogfood-first adoption path) and D-018 (tRPC web↔module layer). Phase 1 split into 1a (dogfood CRM) / 1b (M1 demo slice) / 1c (hardening); CSV import moved to Phase 2; PDPA enforcement + multi-user polish set as Phase 2 entry work. Dogfood metrics and dogfooding-blindness risk added. Q-1 and Q-4 resolved, Q-6 deferred, Q-7 reframed (Gmail test-mode for dogfood). D-003 full org→workspace→team hierarchy from P0 explicitly confirmed by founder.
- **v0.1 (2026-07-11)** — Initial master plan. 12 modules defined; decisions D-001…D-016; phases 0–4; MVP scope; alignment protocol.
