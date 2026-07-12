# casper-workflow — Plan

**Status:** Draft v0.2 | **Layer:** Engine | **Phases:** 1+ (core), 3 (simulation/shadow/rollout) | **Depends on:** casper-records, casper-events, casper-platform | **Used by:** casper-sales, casper-ai, casper-changesets, casper-feedback, casper-web | **Aligned with:** master-plan v0.5 (D-006, D-007, D-014, D-017, D-025)

## Purpose

"Workflows" and rule-driven "actions": versioned stage models with guarded transitions, assignment and SLA rules, and a trigger–condition–action automation engine over domain events. Designed from day one so definitions are **immutable versions** evaluated by a **pure function** (D-014) — that single constraint is what makes Phase-3 simulation, shadow mode, and gradual rollout cheap instead of a rewrite.

## Scope

**In**
- **Workflow definitions** (per record type): stages (key, name, category: `open | won | lost | closed`, color, order), transitions (from→to, guards: required fields present, condition Filter AST, permission requirement), entry/exit hooks (emit events; effects via automations).
- **Transition API:** `transition(recordRef, toStage, principal)` — validates legality + guards + `can('record.transition')`, writes stage via casper-records, emits `<type>.stage_changed`. The *only* way stage changes (UI drag, AI proposal commit, automation all call this).
- **Assignment rules:** on-create/on-transition assignment (round-robin, by territory field, fixed) — v1 simple, declarative.
- **SLA / staleness rules:** declarative rules (`stage age > N`, `no activity within N days`) evaluated by a scheduled scan (casper-api cron) → emit `workflow.sla_breached` / `record.neglected` events. These events are what the sales assistant and notifications consume — "neglect" is defined *here* as config, not hardcoded in AI.
- **Automations (trigger–condition–action):** trigger = domain event match; condition = Filter AST over record + event payload; actions v1 = `create_task`, `update_field`, `transition`, `notify`; P2+: `draft_email` (via casper-comms, draft-only), `enqueue_webhook` (P4). Declarative JSON definitions — human-editable in admin UI, machine-proposable by casper-feedback.
- **Automation runtime:** consumes events (via casper-events registry), evaluates pure `evaluate()`, executes effects through module APIs; run log per execution (trigger event, condition result, actions, duration, errors); **loop protection**: causation-chain depth limit, automation cannot match events it caused (`source='automation'` + own causation), per-record rate cap.
- **Versioning & publishing (D-006/D-014):** definitions immutable; draft → publish creates version N+1 **through a change set** (preview of what changes, one-click rollback = repoint active version). Records stamp `workflowVersion` on entry; publish policy: new records use new version, in-flight records keep pinned version unless a stage-mapping migration is provided.
- **Phase 3:** **historical simulation** (replay a time-window of past events/records against a candidate version → report: which records would have behaved differently, workload shifts, exceptions); **shadow mode** (candidate version evaluated live alongside active, effects logged not executed, divergence report); **gradual rollout** (activate per team / percentage / new-records-only).

**Out**
- Record storage (casper-records), event transport (casper-events), approval of publishes (casper-changesets), the *content* of any specific pipeline (casper-sales), AI proposal generation (casper-ai / casper-feedback).

## Key design points

- **Purity contract:** `evaluate(definitionVersion, record, event, now) → Effect[]` — no I/O, no clock reads, no randomness. Effects (`CreateTask`, `UpdateField`, `Transition`, `Notify`, …) are data; the runner executes them. Simulation = same function, effects collected instead of executed. Shadow = same function, effects logged. This is the module's architectural core; protect it in review.
- **Config as data:** stage/transition/automation definitions are JSON validated by zod schemas — enabling change-set diffs, AI-generated proposals, and versioned storage without code deploys.
- **Automations are the Level-1/2 change surface** (reference doc §12): most business evolution should land as automation/config changes, not code. The feedback module (P3) proposes exactly these objects.

## Data model sketch

`workflow_definitions (type, version, status: draft|active|retired, definition JSONB)`, `automation_definitions (versioned, enabled, definition JSONB)`, `automation_runs (trigger event id, result, effects, error)`, `sla_rules` (inside workflow definition), rollout scopes (P3: `workflow_rollouts`).

## Events emitted / consumed

Emits `<type>.stage_changed`, `workflow.published/rolled_back`, `workflow.sla_breached`, `record.neglected`, `automation.executed/failed`. Consumes any registered domain event as automation trigger.

## Phasing

- **P1a (dogfood CRM, master-plan v0.2):** definitions + transition API + guards; simple assignment; SLA scan (inactivity/stage-age) — the board and "neglected" views depend on these.
- **P1b/1c:** automation engine with 4 core actions + run log + loop protection; publishing via change sets (basic preview); casper-sales pipeline runs on it end to end.
- **P2:** draft_email action; richer guards (role-based); automation templates; run-log UI.
- **P3:** simulation, shadow mode, gradual rollout, divergence reporting; stage-mapping migrations for in-flight records.
- **P4:** webhook action; cross-type automations if demanded.

## Playground (D-025 — committed surface)

Dev-only surface in `casper-workflow/playground/`, mounted via `pnpm play workflow` (ships P1a with the core engine). Exercises:

- **Stage-model visualizer:** stages/transitions/guards of any definition version, rendered from the JSON config.
- **`evaluate()` scratchpad:** pick definition version + record + event + `now` → the returned `Effect[]`, nothing executed — the purity contract (D-014) makes this the module's cheapest and most valuable test surface.
- **Transition tester:** attempt transitions as any principal → guard results, `can('record.transition')` outcome, emitted event preview.
- **Automation dry-run:** feed a synthetic event through an automation definition → condition evaluation + effects + run-log entry; includes a self-triggering rule to demo loop protection.
- **Publish preview:** version diff for a draft definition as the change set would show it; rollback repoint demo. (P3: simulation/shadow divergence report viewer.)

## Open questions

- Where does automation execution order matter (multiple automations match one event)? Default: deterministic order by definition id + no chaining beyond depth limit; revisit with real usage.
- Stage stored in `records.data.stage` vs dedicated column (default: dedicated column on records table for index/board performance — coordinate with casper-records before P1 build).

## Success criteria

- Deal pipeline (casper-sales) expressed 100% as config; zero sales-specific code here.
- Automation loop-protection test: self-triggering rule terminates safely and visibly.
- A workflow publish shows a human-readable diff and can be rolled back in one click (P1).
- Simulation of a 90-day event window over a candidate version completes < 60s for MVP-scale data and its report matches shadow-mode behavior (P3).
