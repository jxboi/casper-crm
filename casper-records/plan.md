# casper-records — Plan

**Status:** Draft v0.1 | **Layer:** Engine | **Phases:** 0+ | **Depends on:** casper-platform, casper-auth, casper-events | **Used by:** casper-workflow, casper-changesets, casper-ai, casper-sales, casper-comms, casper-web | **Aligned with:** master-plan v0.2 (D-002, D-012, D-013, D-017)

## Purpose

The record engine — "Objects" in the objects/workflows/actions model. Configurable record types with typed fields, relationships, validation, querying (filters/views/search), and import/export. Product modules define their types as config; the engine stays domain-agnostic. **There is exactly one write path** — used identically by UI edits, imports, automations, and change-set commits — so validation, permissions, and events can never be bypassed.

## Scope

**In**
- **Record types:** key, name (singular/plural), icon/color, origin (`system` — defined in code | `product` — seeded config, versioned), primary-label field.
- **Field registry:** types — text, long text, number, money (minor units + currency, D-012), date, datetime, select, multi-select, checkbox, user, relation, email, phone, URL, JSON (escape hatch). Each field: key, label, required?, unique?, default, options, validation rules, `sensitivity` flag (drives field masks in casper-auth + AI masking), archived?.
- **Storage (D-013):** `records` table — id (uuidv7), org, workspace, type, `data` JSONB (GIN-indexed), owner, `version` (int, optimistic concurrency — the `baseVersion` change sets check), `last_activity_at` (maintained via events), search tsvector, timestamps, archived_at. Generated columns promoted for hot fields when profiling justifies.
- **Validation:** field defs compile to zod schemas (cached per type+version). Same validator runs on direct writes and change-set commit re-validation.
- **Write API:** `createRecord`, `updateRecord` (partial, field-mask-aware), `archiveRecord`, `transitionOwner`, bulk variants. Every write: `can()` check → validate → persist (+version bump) → emit domain event (`<type>.created/updated/...` with field-level diffs in payload).
- **Relations:** typed relation definitions (one-to-many / many-to-many, semantic labels e.g. "deal → primary contact"); `relations` join table; cascade rules (restrict/nullify on archive).
- **Query engine:** the shared **Filter AST** (master-plan §6) → parameterized SQL. Operators include relative-date (`within_last`, `older_than`) and activity operators (`no_activity_within` via `last_activity_at`) — these power "neglected deals" for the assistant and views alike. Sorts, cursor pagination. Query-level permission scoping (workspace/team/own).
- **Saved views:** named Filter AST + sort + visible columns + layout (`table` | `board(groupByField)` | `list`), personal or shared, per record type.
- **Search:** Postgres FTS over label + text fields per org; typeahead for relation pickers.
- **Import/export:** CSV export in P1 (cheap, and it emits the `export.clicked` interaction event — a feedback signal); CSV import with column mapping + dry-run report moved to **P2** (design-partner prerequisite — dogfood uses seed data, D-017); dedupe suggestions (email/domain match) P2.
- **System record types (code-defined):** **Task** (title, assignee, due, status, priority, `relatedTo` RecordRef, source: manual|automation|ai), **Note**, **Attachment** (blob ref via platform, relatedTo).

**Out**
- Stages/transitions (casper-workflow — records store `stage` in `data`, workflow owns its legality), timeline/comments (casper-events), diff/preview UX (casper-changesets + web), product type definitions (casper-sales).

## Key design points

- **Single-writer path is non-negotiable:** casper-changesets applies approved changes *through this module's write API*, not via its own SQL. Guarantees identical validation/events for human and AI mutations.
- **Optimistic concurrency:** every update carries expected `version`; mismatch → `conflict` AppError. This is the substrate for change-set conflict detection.
- **Config versioning for product types:** type/field definitions are versioned snapshots; casper-sales seeds v1; edits via admin UI create new versions through change sets (P2+). Records don't need migration on additive changes; destructive field changes require an explicit migration plan (deferred).
- **Field-diff events:** update events carry `{field, before, after}` — the timeline, audit, and feedback field-churn detector all depend on this shape.

## Events emitted / consumed

Emits `<type>.created/updated/archived`, `task.completed`, `import.completed`, plus interaction `export.clicked`. Consumes activity-relevant events to maintain `last_activity_at` (via casper-events denormalizer).

## Phasing

- **P0:** types/fields/records/relations CRUD; validation; write API + events; Filter AST + basic views (table); Task system type; FTS search.
- **P1:** board views; CSV export; activity operators; attachments; relation pickers; field sensitivity flags.
- **P2:** CSV import (mapping + dry-run); dedupe suggestions; field editor UI hardening; generated-column promotion; uniqueness constraints.
- **P3+:** type/field editing via change sets with preview; computed/rollup fields (only if product demands).

## Open questions

- Rollup/computed fields (e.g. company.open_deal_value): defer or thin P2 version? (Default: defer; dashboards can aggregate at query time.)
- Per-workspace type customization vs org-global types (default: org-global definitions, workspace-scoped data).

## Success criteria

- A new record type is definable purely as config (no engine change) — proven by casper-sales seeding.
- One write path: grep-level guarantee that nothing else INSERT/UPDATEs `records`.
- Filter AST covers 100% of MVP view + automation-condition + assistant-query needs (no raw SQL leaks).
- 10k-record workspace: list views < 200ms P95.
