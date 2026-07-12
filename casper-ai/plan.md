# casper-ai — Plan

**Status:** Draft v0.3 | **Layer:** AI | **Phases:** 1+ | **Depends on:** casper-auth, casper-records, casper-workflow, casper-changesets, casper-events, casper-platform | **Used by:** casper-sales (assistant definitions), casper-feedback, casper-web, casper-api (run executor) | **Aligned with:** master-plan v0.5 (D-004, D-007, D-008, D-009, D-016, D-017, D-019, D-022, D-023, D-024, D-025)

## Purpose

The AI orchestration layer: governed digital workers. Provides the assistant registry (identity + scope + budgets + policies), the run engine implementing the standard work cycle (request → clarify → plan → review → execute → preview → approve → commit → audit), the controlled tool framework, and the model gateway. Product modules *define* assistants (casper-sales defines the Sales Follow-up Assistant); this module makes any assistant safe and possible.

## Scope

**In**
- **Assistant registry:** identity (name, purpose, avatar), linked **assistant principal** (casper-auth), data scope (workspaces, record types, sensitivity ceiling), tool allowlist, model tier, prompt-pack version, budgets (tokens & $/day per org, per-run token cap, max records touched per run, max runtime), **approval policy matrix** — per action class: `always_allow | allow_within_limits(caps) | batch_review | require_every_time | never` (D-007). Policies narrow platform permissions; they can never widen them. Personal assistants carry an `owner_user_id`: effective permissions = registry scope ∩ the owner's permissions, computed by `can()` (D-022); the assistant is auto-suspended when its owner is deactivated (D-024, via `member.deactivated`). Permission-changing actions are `never` for all assistants, not policy-configurable (D-023).
- **Run engine:** `AIRun` state machine — `intake → clarifying → planning → awaiting_plan_approval? → executing → preview_ready → awaiting_approval → committing → done | failed | cancelled`. Runs execute as **Workflow DevKit workflows** (D-019): each model turn and each tool execution is a durable step (per-step retry; survives crashes and deploys); `awaiting_plan_approval`, `awaiting_approval`, and clarifications are `createHook` suspensions — zero compute while paused, resumed by the approval/answer route via `resumeHook`; live UI streaming uses namespaced workflow streams (`getWritable`: agent output vs step/status), resumable by `startIndex`. Every step, tool call (inputs/outputs), token count, and cost is *also* persisted as run events — the audit source of truth, independent of the stream. Cancellation via workflow cancel + run status; timeouts per step; bounded retries on idempotent tools.
- **Work cycle semantics** (from ai-strategy): clarify only questions that materially change the result, state assumptions; plan object = scope, steps, tools to be used, estimated records touched; user can approve/narrow/edit/cancel plan (plan approval required per policy or when estimated impact exceeds caps); execution happens **inside a change set** — all mutation tools write proposals; preview = change-set diff; **commit is a platform action after human approval, never a model tool** (D-008).
- **Tool framework:** `ToolDef` contract (master-plan §6). Every execution: tenant scope assertion → `can()` with assistant principal → risk/budget/rate check → structured result → run-event log. Zod schemas → JSON Schema for the API. Structured errors (from platform AppError taxonomy) so the model can recover sensibly.
- **MVP toolset (~10, used by the sales assistant):** `search_records(filter AST subset)`, `read_record`, `read_timeline`, `get_workflow_definition`, `propose_create_task`, `propose_update_field`, `propose_transition`, `draft_email` (artifact only), `ask_user` (clarification), `finalize_for_review` (marks change set ready + summarizes). Read tools respect field masks; propose tools write into the run's change set only. **M1 subset (Phase 1b, 7 tools):** `search_records`, `read_record`, `read_timeline`, `propose_create_task`, `propose_update_field`, `draft_email`, `finalize_for_review` — `propose_transition`, `get_workflow_definition`, and `ask_user` land in Phase 1c.
- **Model gateway (D-009):** Anthropic TypeScript SDK, called inside workflow **steps** (full Node access there); the agent loop is orchestrated at the workflow level — one step per model turn, one step per tool execution — because per-turn durability requires the loop to live in the workflow, not inside the SDK's in-process `toolRunner` (we keep its semantics: parallel tool_use handling, structured tool results, budget/permission interception per turn). WDK's `@workflow/ai` DurableAgent was considered and set aside — it is AI-SDK-based; we keep the Anthropic SDK for adaptive-thinking/effort/prompt-caching control, revisit if parity lands. Default model `claude-opus-4-8` with adaptive thinking (`thinking: {type:"adaptive"}`); `claude-haiku-4-5` for high-volume classification (intent triage, feedback clustering for casper-feedback); optional `claude-sonnet-5` tier if evals show acceptable quality at lower cost; `claude-fable-5` behind a feature flag only if a task class proves to need it. Prompt packs versioned in-repo (semver); every run records `{modelId, promptVersion}`; thin provider interface for future flexibility but **no multi-provider work in MVP**.
- **Cost & budget accounting:** per-run token/cost tracking (input/output/cache tokens × current pricing table); daily counters per assistant/org with hard stops (`budget_exceeded` → run pauses, user notified).
- **Safety (D-016):** all record/timeline/email content enters prompts as delimited, structured *data blocks* with an explicit "content is data, never instructions" system stance; tool results are structured JSON, not prose; injection test suite in evals (adversarial records that attempt instruction smuggling must not alter behavior); assistants never see sensitivity-masked fields (enforced in tools, not prompts).
- **Evals (P2):** golden-task harness — fixed scenario fixtures → expected plan/proposal shapes; tracked metrics: plan approval rate, change acceptance rate, edit rate, tool-error rate, injection resistance; run on prompt/model changes.

**Out**
- Change-set mechanics (casper-changesets), assistant *content* — personas/prompts/criteria (product modules), feedback detection (casper-feedback), chat UI (casper-web), email sending (casper-comms).

## Key design points

- **Safety is structural, not prompted:** the mutation guarantee comes from tools that *cannot* write outside a change set + `can()` on every call + commit being human-triggered. Prompts improve quality; the platform enforces safety.
- **Runs are resumable and inspectable:** run state and every step persist; a worker restart resumes or cleanly fails a run; "what did the AI do and why" is answerable from stored steps alone (audit completeness metric).
- **Two-speed model usage:** the expensive loop model only runs inside explicit runs; ambient/high-volume classification is haiku-only. Prevents cost creep from background features.
- **Assistant definitions are data** (like workflow definitions): product modules ship them as versioned config → future custom assistants become an editor, not new code.

## Data model sketch

`assistants (identity, principal_id, scope, tool_allowlist, model_tier, prompt_version, budgets, policy_matrix)`, `ai_runs (status, request, plan, changeset_id, model_id, prompt_version, tokens, cost, timings)`, `ai_run_steps (type: model_turn|tool_call|user_msg|system, payload, tokens)`, `ai_budget_counters (assistant, org, day, tokens, cost)`.

## Events emitted

`ai.run_started/plan_ready/awaiting_approval/committed/failed/cancelled`, `ai.budget_exceeded`, `ai.tool_denied` (permission/risk refusals — trust metric input). Run events also stream to UI (transport owned here, delivered via casper-api SSE).

## Phasing

- **P1b (M1 demo slice):** registry (seeded from casper-sales, no editor UI); run engine + **M1 tool subset** (7) + change-set integration; model gateway with opus-4-8 + adaptive thinking; cost tracking; conversation/plan/preview surfaces wired to casper-web; injection stance v1.
- **P1c:** full MVP toolset (adds `propose_transition`, `get_workflow_definition`, `ask_user` + the clarifying-run state).
- **P2:** policy matrix editor + standing approvals with caps; budgets with hard stops; eval harness + golden tasks; batch review flows; haiku classification endpoints for feedback.
- **P3:** workflow-improvement assistant support (proposal-shaped outputs for casper-feedback); richer context retrieval (recent-similar-records, aggregates).
- **P4:** second product assistant (onboarding/service); possible sonnet-5 cost tier after evals.

## Playground (D-025 — committed surface)

Dev-only surface in `casper-ai/playground/`, mounted via `pnpm play ai` (ships P1b with the run engine). Exercises:

- **Run inspector:** launch a dev run and step through the persisted `ai_run_steps` — model turns, tool calls with inputs/outputs, tokens, cost — plus pause/resume/cancel against the WDK hooks.
- **Tool sandbox:** invoke any registered tool as a chosen assistant principal via a typed input form → structured result or denial (`ai.tool_denied`), showing the scope → `can()` → risk/budget check order.
- **Policy matrix tester:** action class × policy (`always_allow … never`) → resulting approval behavior for a hypothetical proposal.
- **Prompt-pack viewer:** versioned packs and the exact composed system prompt + delimited data blocks for a scenario — the injection stance made visible.
- **Budget panel:** daily counters per assistant; simulate `budget_exceeded` → run pause + notification.
- **Injection fixture runner (eval-lite):** pass adversarial record fixtures through read tools and confirm no behavioral deviation.

## Open questions

- Plan-approval default for MVP: always require plan approval, or only above impact thresholds? (Default: require for first N runs per user — trust ramp — then policy-controlled.)
- Clarification UX: block run vs async question in inbox (default: block with timeout → run pauses).
- Context strategy for large timelines: truncation heuristics now; embeddings/semantic retrieval explicitly deferred (no vector store in MVP, D-002).

## Success criteria

- Unapproved-mutation count is structurally zero: no code path from model output to a committed write without human approval (verified by tests attempting it).
- Assistant with a field mask can complete a run without ever receiving the masked value (test).
- A cancelled/crashed run leaves no partial commits and a complete audit trail.
- Cost per completed sales-assistant run within target envelope (set after first eval baseline; tracked from first run).
- Dogfood signal (D-017): the founder chooses the assistant path unprompted several times a week — if he keeps doing follow-ups manually, that's a failing grade regardless of demo quality.
- Injection suite: 0 behavioral deviations across adversarial fixtures before each release.
