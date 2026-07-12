# casper-auth — Plan

**Status:** Draft v0.3 | **Layer:** Foundation | **Phases:** 0+ | **Depends on:** casper-platform | **Used by:** every module (via `can()`), casper-ai (assistant principals) | **Aligned with:** master-plan v0.5 (D-003, D-004, D-007, D-016, D-017, D-020, D-021, D-022, D-023, D-024, D-025)

## Purpose

Identity and access for humans *and* AI. Provides authentication, the tenancy hierarchy (org → workspace → team), role-based permissions with field-level masks, and the single authorization gate `can(principal, action, resource)` that every module and every AI tool calls. The load-bearing idea (D-004): **assistants are principals in the same system as users** — their access is enforced here, not in prompts.

## Scope

**In**
- **AuthN:** **GitHub OAuth as the primary login for the dogfood phase** (D-017 — founder is the only user), plus email+password. Google OAuth + magic link land before design partners onboard (P2). Sessions (httpOnly cookies), CSRF, password reset, email verification. Provider: **better-auth** with organizations plugin — Q-1 resolved in master-plan v0.2; the GitHub social provider is built-in.
- **Tenancy entities:** Organization, Workspace, Team, Membership (user × workspace × role), Invitation (email invite flow, role pre-assignment).
- **Roles & permissions:** built-in roles — Org Owner, Org Admin, Workspace Admin, Manager, Member (Guest cut per D-020; external/record-scoped sharing is a future feature if demand appears). Role = bundle of permission grants: `action` (e.g. `record.update`, `changeset.approve`, `workflow.publish`) × `scope` (org / workspace / team / own-records) × optional record-type qualifier. Custom roles deferred to P3+.
- **Access semantics (D-020, D-021):** reads are workspace-wide (open read — every member reads every record in their workspace; list queries filter by workspace only, no per-row visibility). Writes resolve through grant scopes: `own` = record owner is the actor; `team` = actor shares ≥ 1 team with the record's owner (records carry no team_id — team membership derives it; users may belong to multiple teams and team grants union across them); `workspace` = any record in the workspace. Manager semantics are org-configurable — `managerModel: 'workspace' | 'team_lead' | 'reporting_line'`, default `workspace` — and resolve "owner's manager" for consumers like casper-sales notifications; only the `workspace` model is implemented before P2.
- **Member lifecycle (D-024):** membership `status: active | deactivated`. Deactivation blocks login, revokes sessions, suspends the member's personal assistant (casper-ai reacts to the event), and flags their pending authored change sets (casper-changesets reacts). Owned records keep ownership until an admin bulk-reassigns. Human admin actions on members/roles/grants are direct writes — `can()`-gated + audited, never change-setted; assistants can never perform permission actions (D-023).
- **Field-level access:** per record-type field masks (read/write) attachable to roles **and to assistant principals** — fields carry a `sensitivity` flag in casper-records; masks reference it. Minimal version ships in P1 because assistant scoping needs it. Default posture (D-020): all members read all fields, including sensitive ones — sensitivity raises edit risk (D-007) and caps assistants; human read-masks are opt-in per role from P2.
- **Principal abstraction:** users, **assistant principals** (created/managed by casper-ai but registered here; cannot log in; only impersonated server-side by the run executor), API keys (hashed, org-scoped, P4 for public API), system principal (migrations/jobs).
- **`can()` decision engine:** deterministic evaluation of role grants + field masks + resource ownership; returns allow/deny + reason. Deny decisions are emitted as events (`auth.permission_denied`) — feeds the "permission-denial correctness" metric.
- **Admin surface (via casper-web):** members list, invites, role assignment, workspace management.

**Out**
- Approval policies and budgets (casper-ai — they consume principals defined here), audit storage (casper-events), user notification preferences (casper-events), billing/seats (future casper-billing), SSO/SAML (post-MVP, enterprise).

## Key design points

- **`can()` is synchronous-fast and cache-friendly:** role grants loaded per request into the tenancy context; decisions are pure functions over that snapshot. Target < 1ms per check so modules can call it liberally (list filtering uses query-level scoping instead of per-row checks).
- **Actions are namespaced strings**, centrally registered (typo-proof via a generated union type). Field-level checks use `record.field.read:<type>.<field>` / `...write:...`.
- **Assistants get *narrower* grammar than users:** an assistant principal's grants can only reference read/draft/propose actions plus the specific tool permissions listed in its registry entry; grant-widening requires a human admin action (logged, high-risk). **Personal assistants are additionally capped by their owner (D-022):** `can()` computes effective permissions as registry scope ∩ the owning user's permissions at decision time, so demotions and masks propagate to the assistant automatically.
- **Every write path in every module** calls `can()` before mutating — enforced by convention + code review + a test helper that asserts denial for an unauthorized principal on each public API.

## Data model sketch

`users`, `organizations (incl. settings: manager_model, D-021)`, `workspaces`, `teams`, `team_members (multi-team supported; team_lead flag reserved for P2)`, `memberships (user_id, workspace_id, role, status: active|deactivated)`, `invitations`, `roles (built-in + future custom)`, `role_grants`, `field_masks`, `assistant_principals (id, org, name, created_by, owner_user_id — capping per D-022)`, `api_keys (hash, scopes, last_used)`. Reserved, not built: `manager_id` reporting-line edge on memberships (P3+, D-021).

## Events emitted

`user.signed_up`, `org.created`, `workspace.created`, `member.invited/joined/role_changed/removed`, `member.deactivated/reactivated` (consumed by casper-ai — assistant suspension — and casper-changesets — pending-set flagging, per D-024), `member.records_reassigned`, `auth.permission_denied`, `api_key.created/revoked`.

## Phasing

- **P0:** authN complete (GitHub OAuth + email/password); org/workspace/team CRUD; invites; built-in roles; `can()` v1 (action × scope); RLS integration with platform context. Full hierarchy ships in P0 per founder decision (master-plan changelog v0.2) — functional UI is enough; visual polish waits for P2.
- **P1:** assistant principals + field masks (minimal: sensitivity-flag masking); deny-event emission.
- **P2:** Google OAuth + magic link (design-partner logins, D-017); invite/member-management visual polish; per-assistant grant editor UI; session security hardening (device list, revoke); team-lead manager model (D-021); member deactivation + bulk-reassign flow (D-024); opt-in read-masks per role (D-020).
- **P3+:** custom roles; reporting-line manager model (D-021); SCIM/SSO exploration if enterprise demand.

## Playground (D-025 — committed surface)

Dev-only surface in `casper-auth/playground/`, mounted via `pnpm play auth` (ships P0; mask/cap scenarios land with P1 features). Exercises:

- **`can()` explorer:** pick principal × action × resource (± field) → allow/deny + reason, straight from the decision engine.
- **Tenancy sandbox:** org/workspace/team/membership/role editing on dev data — including multi-team membership and the team-write union rule (D-020).
- **Assistant-cap demo (D-022):** demote the owning user or add a field mask, watch the personal assistant's effective permissions narrow live with zero assistant-grant edits.
- **Field-mask tester (P1):** sensitivity-flagged fields vs assistant reads.
- **Deny feed:** `auth.permission_denied` events produced by playground actions, for eyeballing deny-reason quality.

## Open questions

- ~~Should Guests be workspace-scoped share links or real memberships?~~ Resolved v0.4: Guest role cut entirely (D-020); external/record-scoped sharing is a future feature if demand appears.

## Success criteria

- Cross-tenant and cross-workspace access attempts fail in CI tests (Phase 0 exit).
- An assistant principal with deals-read scope cannot read a sensitivity-masked field even when a tool requests it (P1 test).
- Demoting a user immediately narrows their personal assistant's effective permissions with zero assistant-grant edits (D-022 capping test, P1).
- 100% of module write paths guarded by `can()` (checked by the shared test helper).
