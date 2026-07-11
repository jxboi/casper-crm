# casper-changesets — Plan

**Status:** Draft v0.1 | **Layer:** Engine | **Phases:** 1+ | **Depends on:** casper-records, casper-workflow, casper-events, casper-auth | **Used by:** casper-ai (all mutations), casper-workflow (publishing), casper-feedback (proposals), casper-web (review/approve UX) | **Aligned with:** master-plan v0.2 (D-006, D-007, D-017)

## Purpose

The transactional workspace and change-set model — architectural bet #1 (master-plan §2). Risky mutations from *any* origin (AI runs, workflow publishes, bulk edits, feedback proposals) become structured, previewable, individually-approvable, atomically-committable, and rollback-able change sets. Live data is untouched until approval. This module is why "the AI edited production data without approval" is impossible by construction rather than by policy.

## Scope

**In**
- **ChangeSet lifecycle** (shapes in master-plan §6): `draft → in_review → approved → committing → committed | rejected | rolled_back`. Author is a Principal (human or assistant); origin tags (`ai_run`, `manual`, `workflow_publish`, `feedback_proposal`) link back to the originating object.
- **Change ops:** `create` / `update` (field-level payloads) / `delete(archive)` / `transition` / `config_publish` (workflow/automation/field-config versions). Each change carries `baseVersion`, computed `risk` (D-007 mapping + field sensitivity), validation result, per-change approval state (**selective approval** is first-class).
- **Draft-time validation:** every change validated through the *owning module's* validator (records zod / workflow schema) when added — assistants and users see problems before review, not at commit.
- **Overlay reads:** `readThroughChangeset(changesetId, ref)` — base record + pending ops merged. Lets AI continue multi-step work against its own uncommitted state and lets preview render "after" values. Explicitly **not** DB branching (rejected: per-tenant runtime branching isn't practical on shared Postgres; Neon branches are per-database and suit CI, not tenant workspaces).
- **Diff & preview:** field-level before/after per change; aggregate summary (N records touched, risk histogram, warnings); conflict markers.
- **Conflict detection:** at review-refresh and again at commit, compare `baseVersion` to live version; drifted changes flagged `stale` → require re-validation + re-approval (never silently clobber).
- **Approval:** `can('changeset.approve')` gated; risk-aware rules (high-risk requires explicit per-change approval; medium can be batch-approved; low auto-approvable per casper-ai policy); Q-3 (self-approval of high-risk) default: disallowed for orgs with >1 eligible approver.
- **Commit:** approved changes applied **through module write APIs** (records/workflow) in a single transaction where possible; partial commit = approved subset; every applied change emits normal domain events with `causationId = changeset` and `source` reflecting origin; inverse ops captured per applied change.
- **Rollback:** one-click creates a *compensating* change set from stored inverse ops (auditable, re-approvable — not time travel); warns where subsequent edits make inversion lossy.
- **Artifacts:** files/drafts attached to a change set's workspace (email drafts, generated reports) — blob-backed, surfaced in the Workspace AI surface; artifacts are *not* committed anywhere, they're deliverables.

**Out**
- Approval *policy* definitions (casper-ai owns the assistant policy matrix; this module enforces outcomes), diff UI rendering (casper-web), run orchestration (casper-ai), event transport (casper-events).

## Key design points

- **Ops-as-data, apply-through-APIs:** a change set is a list of declarative ops. Commit never writes tables directly — it calls `records.updateRecord(...)` / `workflow.transition(...)` etc. One write path (see casper-records) keeps validation/permissions/events uniform.
- **Risk is computed, not declared:** op type × target × field sensitivity → risk class via the D-007 mapping; an assistant cannot label its own work low-risk.
- **Commit is idempotent & resumable:** committing state + per-change applied markers; a crash mid-commit resumes or cleanly reports partial application (partials are visible, never silent).
- **Everything links:** changeset ↔ ai_run ↔ proposal ↔ feedback — the audit chain the reference docs demand ("source feedback → change → outcome").

## Data model sketch

`changesets`, `changes (changeset_id, op, target, payload, base_version, risk, approval, validation, applied_at, inverse_op)`, `changeset_artifacts`, `changeset_reviews (who, decision, note, at)`.

## Events emitted

`changeset.created/submitted/approved/partially_approved/rejected/committed/commit_failed/rolled_back`, `change.flagged_stale`.

## Phasing

- **P1 (lands in Phase 1b — the M1 demo slice, per master-plan v0.2):** full lifecycle for record ops (create/update/transition) + artifacts + diff + selective approval + commit + audit events; basic conflict detection at commit; workflow `config_publish` op (simple diff) may trail into 1c.
- **P2:** rollback via compensating sets; stale-change re-review flow; batch approvals; commit resumability hardening; bulk-edit UX origin.
- **P3:** feedback-proposal origin; simulation-result attachments on config publishes; richer config diffs.

## Open questions

- Q-3 (master): self-approval rules for high-risk changes — finalize with first design partner.
- Overlay depth: does MVP AI need overlay reads at all, or is "propose then re-read live" enough? (Default: ship minimal overlay — merged read of own pending ops — since multi-step runs need it; no cross-changeset overlays.)

## Success criteria

- Zero direct-table writes: commit path provably routes through module APIs (lint + tests).
- A 50-change AI run previews with correct diffs, supports approving 30/rejecting 20, commits atomically, and every applied change appears in audit with the changeset causation id.
- Concurrent human edit to a record in a pending change set → change flagged stale, commit blocked until re-approval (P2 test).
- Rollback of a committed set restores prior field values or explicitly reports lossy fields (P2 test).
