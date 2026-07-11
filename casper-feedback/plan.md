# casper-feedback — Plan

**Status:** Draft v0.1 | **Layer:** AI | **Phases:** 1 (capture) → 3 (full loop) | **Depends on:** casper-events, casper-changesets, casper-workflow, casper-ai (haiku classification), casper-platform | **Used by:** casper-web (widget + change studio), casper-workflow (proposals become config publishes) | **Aligned with:** master-plan v0.3 (D-005, D-006, D-009, D-017)

## Purpose

The workflow-evolution loop — the product's core differentiator (reference doc §§9–17): *Observe → Suggest → Simulate → Test → Release → Measure → Improve.* Captures contextual feedback where work happens, detects the workarounds users never report, clusters both into themes, turns themes into structured change proposals (machine-readable workflow/automation edits), routes them through simulation + change sets + pilots, and measures whether the change actually helped.

## Scope

**In**
- **Contextual feedback capture (P1 — cheap and valuable early):** widget available on every screen; user selects target (page, field, button, stage, view) or just types; system auto-captures context — route, RecordRef, workflow state, user role, action being attempted, recent activity refs; body: text + optional screenshot (blob); voice deferred (P4). Stored as feedback items; emits `feedback.submitted`; simple triage list (status: new/acknowledged/planned/done, dedupe-merge) for the founder/admin.
- **Workaround signal detection (P3):** detectors consuming interaction + domain events (D-005 two-stream design). Initial detector set, each cheap and explainable:
  - frequent CSV exports of the same view (export → external-spreadsheet work)
  - repeated manual creation of same-shaped tasks after the same event type (automation candidate — the doc's canonical example)
  - stage-skip rate per transition (workflow doesn't match reality)
  - field overwrite churn (field means something else / wrong stage placement)
  - long stage-dwell vs baseline (bottleneck)
  - copy-to-clipboard bursts from record pages (data leaving the system)
  Output: `Signal { detector, evidence: eventRefs[], affectedUsers, frequency, confidence }`.
- **Clustering & themes (P3):** group feedback items + signals into themes via `claude-haiku-4-5` classification (D-009) + heuristic keys (same workflow/stage/field); theme = problem statement + combined evidence + affected-user estimate from event data.
- **Change proposals (P3):** structured `ChangeProposal` — problem, sources (feedback[] + signals[]), affected workflow/config ref, **proposed change as machine-readable config** (automation definition draft / workflow edit / field change — the same JSON casper-workflow consumes), estimated impact (from event stats: occurrences/week × time heuristic), risk class, suggested pilot scope, success metric + review date, status: `proposed → accepted → piloting → measuring → adopted | reverted`. Drafted by AI (proposal-shaped run in casper-ai), always human-reviewed.
- **Execution path (P3):** accepted proposal → change set (`origin: feedback_proposal`) → optional historical simulation + shadow mode (casper-workflow) attached as evidence → approval → pilot rollout scope → full rollout or revert. The **change studio** view (casper-web) shows the whole chain: feedback → theme → proposal → simulation → rollout → outcome.
- **Outcome measurement (P3):** each adopted change stores its success metric as an event-stream query (e.g. "median time in Proposal stage", "manual follow-up tasks per won deal"); scheduled comparison pre/post + at review date; result recorded on the proposal (`adopted`/`reverted` recommendation).

**Out**
- Event collection (casper-events), simulation/shadow engines (casper-workflow), change-set mechanics (casper-changesets), generic product-analytics dashboards (not this module's job — it exists to *change the product config*, not to chart).

## Key design points

- **Capture ships in P1, intelligence in P3:** early feedback with rich context is immediately useful to a founder doing discovery, and it builds the corpus the P3 loop needs. Detectors/clustering before product-market signal would be premature. During dogfooding (D-017) the founder *is* the user: capturing his own friction through the widget is both the P3 corpus seed and the stated mitigation for dogfooding blindness (master-plan §11).
- **Proposals are config, not prose:** a proposal's payload is the exact JSON casper-workflow would publish. "Accept" means "open a change set", not "create a ticket". This is what closes the loop the reference doc says is broken in the industry.
- **Evidence-linked everything:** every proposal traces to concrete events/feedback; every adopted change traces to measured outcomes. No vibes-driven workflow churn.
- **Detectors are deterministic + explainable;** the LLM only labels/clusters/drafts. Keeps the loop debuggable and cheap.

## Data model sketch

`feedback_items (context, body, screenshot_ref, status, theme_id)`, `signals (detector, evidence_refs, stats, theme_id)`, `themes`, `change_proposals (problem, sources, target_ref, proposed_config, impact, risk, pilot, metric, status, changeset_id, outcome)`.

## Events emitted / consumed

Emits `feedback.submitted/triaged`, `signal.detected`, `proposal.created/accepted/piloting/measured/adopted/reverted`. Consumes interaction events + domain events (detectors), `changeset.committed` (proposal state sync).

## Phasing

- **P1:** widget + context capture + screenshot; triage list; events.
- **P2:** feedback linked from record/timeline; dedupe assist (haiku similarity on submit).
- **P3:** detector framework + initial 4–6 detectors; clustering; proposals; simulation/shadow integration; pilot scoping; outcome measurement; change studio.
- **P4:** voice notes; email/chat-sourced feedback (via casper-comms ingestion).

## Open questions

- Detector thresholds: fixed defaults vs per-org baselines (default: fixed for first detectors, baseline-relative for dwell-time).
- Should end-users see others' feedback/themes, or admins only? (Default: submitters see own status; themes/studio admin-only until trust established.)
- Privacy line for interaction telemetry per org — needs an org-level setting + disclosure text (with D-016 owner) before P3 detectors ship.

## Success criteria

- P1: submitting feedback takes < 15s and lands with full context attached (route, record, role) without user effort.
- P3: the canonical loop demo passes on real data — repeated manual "kickoff" tasks after `deal.stage_changed→won` are detected, proposed as an automation, simulated, piloted with one team, measured, adopted.
- Every adopted change can show its evidence chain and its measured outcome in one view.
