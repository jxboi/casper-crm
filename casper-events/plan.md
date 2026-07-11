# casper-events — Plan

**Status:** Draft v0.1 | **Layer:** Foundation | **Phases:** 0+ | **Depends on:** casper-platform, casper-auth | **Used by:** casper-records, casper-workflow, casper-changesets, casper-ai, casper-feedback, casper-comms, casper-web | **Aligned with:** master-plan v0.3 (D-005, D-012, D-016, D-017, D-019)

## Purpose

The nervous system. One append-only stream of typed events describing everything that happens — every mutation, transition, AI action, and meaningful user interaction. Audit log, record timelines, notifications, automations, and the entire feedback/evolution loop are *consumers* of this stream. If it isn't an event, the platform can't learn from it.

## Scope

**In**
- **Domain events:** transactional outbox (`domain_events` table written inside the same `withTx` as the mutation, per D-005); dispatch fans out to registered consumers via a post-commit `waitUntil` trigger plus a **sweeper cron** that drains anything a crash left behind (D-019) — at-least-once; consumer handlers idempotent; fan-out executes as workflow steps with per-consumer cursor + retry and dead-letter parking.
- **Consumer registry:** `on('deal.stage_changed', handler)` registration used by workflow automations, feedback detectors, notification rules, timeline projector.
- **Interaction events:** lighter-weight telemetry stream (`interaction_events`) for the feedback loop — `export.clicked`, `view.opened`, `record.copied`, `nav.pattern`, `manual_task.created_after(event)` context. Separate table, sampled where high-volume, shorter retention, org-configurable (privacy, D-016).
- **Audit log:** immutable projection of domain events with actor/subject indexing, retention policy per org, export (CSV/JSON). Includes AI runs' tool calls (summarized refs, full detail stored by casper-ai) and permission denials.
- **Record timeline:** per-`RecordRef` merged, human-readable projection — field changes, stage transitions, tasks, comments, emails, AI proposals/commits. Powers the record page's activity feed.
- **Comments & mentions:** authored timeline entries (markdown-lite), @mentions resolve to users, edit/delete with audit.
- **Notifications:** rule-driven fan-out (mention, task assigned, approval requested, changeset committed/rolled back, SLA breached, assistant needs input) → in-app inbox (read/unread) + email (immediate or digest) via platform systemMail. Per-user preference matrix (channel × notification type). Quiet hours later.
- **Denormalized activity hints:** maintains `last_activity_at` per record (consumed by records module for "neglected" filters).

**Out**
- Event *semantics* (owning modules define and emit their own event types), analytics dashboards (P2, casper-sales/web), workflow triggering logic (casper-workflow consumes events; the engine lives there), AI run step streaming (casper-ai owns run events; they surface here only as audit summaries).

## Key design points

- **Envelope is the contract** (master-plan §6): `type`, `subject`, `actor` (Principal), `source` (`ui|api|automation|ai|system`), `payload` + `schemaVersion`, `correlationId`/`causationId`. `source` + causation chain enable automation loop-protection and clean attribution of AI vs human work — both load-bearing for other modules.
- **Registry of event types** with zod payload schemas, generated docs, and a union type — emitting an unregistered event type fails in dev.
- **Projections are rebuildable:** timeline and audit are derivations; a rebuild command can replay `domain_events` (bounded by retention). Keeps us honest about event completeness.
- **Two streams, different guarantees:** domain events are never sampled and long-retained (audit-grade); interaction events are best-effort telemetry. Don't blur them.

## Data model sketch

`domain_events`, `event_consumer_cursors`, `event_dead_letters`, `interaction_events`, `audit_log` (projection), `timeline_entries` (projection), `comments`, `notifications`, `notification_prefs`.

## Phasing

- **P0:** outbox + dispatcher + consumer registry; audit log; timeline projection v1; comments; minimal notifications (in-app only: mention, task assigned).
- **P1:** interaction events (export/copy/view basics); approval-request notifications; `last_activity_at` maintenance. Notification **email** delivery + prefs may slip to Phase 1c — with a single dogfood user (D-017), in-app is enough.
- **P2:** digests; SLA notifications; audit export; retention config.
- **P3:** richer interaction taxonomy for feedback detectors (defined jointly with casper-feedback); rebuild tooling hardened.

## Open questions

- Retention defaults (proposal: domain events 24 months, interaction events 90 days, audit per plan tier) — confirm against PDPA guidance before launch.
- Are comments a system record type in casper-records instead? (Default: no — comments are timeline-native and don't need fields/views machinery.)

## Success criteria

- Every mutation in every module produces exactly one domain event, atomically (test: kill process between write and dispatch → event still delivered after restart).
- Timeline for a busy record renders < 100ms from projection (no on-the-fly joins over raw events).
- A new consumer can be added without touching emitter code.
