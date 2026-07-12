# casper-auth — Plan

**Status:** Draft v0.3 | **Layer:** Foundation | **Phases:** 0+ | **Depends on:** casper-platform | **Used by:** every module (via `can()`), casper-ai (assistant principals) | **Aligned with:** master-plan v0.5 (D-002, D-003, D-004, D-007, D-016, D-017)

## Purpose

Identity and access for humans *and* AI. Provides authentication, the tenancy hierarchy (org → workspace → team), role-based permissions with field-level masks, and the single authorization gate `can(principal, action, resource)` that every module and every AI tool calls. The load-bearing idea (D-004): **assistants are principals in the same system as users** — their access is enforced here, not in prompts.

## Scope

**In**
- **AuthN:** **GitHub OAuth is the only login for the dogfood phase** (D-017 — founder is the only user). Google OAuth + magic link + the credential-login decision land before design partners onboard (P2) — magic link may replace email+password entirely (open question below); password reset/verification and login rate limiting (platform rate limiter, per-IP + per-account buckets) ship with whatever credential login P2 picks. Sessions (httpOnly cookies), CSRF. Provider: **better-auth** with organizations plugin — Q-1 resolved in master-plan v0.2 (amended v0.5); the GitHub social provider is built-in. **Account linking:** providers sharing a *verified* email auto-link to one user; unverified emails require an explicit link from account settings.
- **Tenancy entities:** Organization, Workspace, Team, Membership (user × workspace × role), Invitation (email invite flow, role pre-assignment). **Teams and team-scoped grants are P2** — no consumer until multi-user; `team` stays a reserved scope value in the grant grammar so nothing needs redesign. **Invitation flow/UI is P2** — better-auth's primitives exist from day one, but P0's cross-tenant tests create their second org via test factories, not invites. **Mapping to better-auth:** the organizations plugin owns only the authN-level entities — Organization, org-level membership, and email invitations. Workspace, Team, and workspace Memberships are casper-auth domain tables layered on top; workspace invites ride the org invitation flow carrying workspace + role pre-assignment as metadata. An invitation is accepted only by a signed-in user whose *verified* email matches it, regardless of login provider.
- **Roles & permissions:** built-in roles — Org Owner, Org Admin, Workspace Admin, Manager, Member, Guest (read-only). **P0 seeds only Org Owner + Member**; the rest (Org Admin, Workspace Admin, Manager, Guest) are seeded in P2 — same grants engine, more rows. Role = bundle of permission grants: `action` (e.g. `record.update`, `changeset.approve`, `workflow.publish`) × `scope` (org / workspace / team / own-records) × optional record-type qualifier. Custom roles deferred to P3+.
- **Field-level access:** per record-type field masks (read/write) attachable to roles **and to assistant principals** — fields carry a `sensitivity` flag in casper-records; masks reference it. Minimal version ships in P1 because assistant scoping needs it.
- **Principal abstraction:** users, **assistant principals** (created/managed by casper-ai but registered here; cannot log in; only impersonated server-side by the run executor), API keys (hashed, org-scoped, P4 for public API), system principal (migrations/jobs).
- **`can()` decision engine:** deterministic evaluation of role grants + field masks + resource ownership; returns a `Decision` (allow/deny + reason + denied fields, master-plan §6). Checks declare `mode: 'enforce' | 'probe'` — only *enforcement* denials (write paths, tool calls) emit `auth.permission_denied` events; UI capability probes stay silent so the audit stream stays meaningful. Deny events feed the "permission-denial correctness" metric.
- **Admin surface (via casper-web):** members list, invites, role assignment, workspace management.

**Out**
- Approval policies and budgets (casper-ai — they consume principals defined here), audit storage (casper-events), user notification preferences (casper-events), billing/seats (future casper-billing), SSO/SAML (post-MVP, enterprise).

## Key design points

- **`can()` is async in signature, synchronous in practice:** the contract returns `Promise<Decision>` where `Decision = { allow: boolean; reason: string; deniedFields?: string[] }` (master-plan §6), but role grants are loaded once per request into the tenancy context and every check resolves from that snapshot without I/O. Target < 1ms per check so modules can call it liberally (list filtering uses query-level scoping instead of per-row checks).
- **Actions are namespaced strings**, centrally registered (typo-proof via a generated union type). Field-level checks use `record.field.read:<recordType>.<fieldKey>` / `...write:...` (master-plan §6 — type-qualified because field keys are unique only within a record type).
- **Team scope resolves through ownership (P2):** a team-scoped grant matches records whose `owner` is a member of one of the principal's teams — no team field on records, which is what makes deferring teams to P2 retrofit-safe. casper-records implements the same rule in its query-level scoping when teams land.
- **Session → context wiring is owned here:** the better-auth session resolves to a `Principal`; the active organization rides the session, while the active *workspace* comes from the route/request and is validated against membership before the platform tenancy context (and RLS session variables) is populated — one middleware, shared by tRPC procedures and route handlers.
- **Assistants get *narrower* grammar than users:** an assistant principal's grants can only reference read/draft/propose actions plus the specific tool permissions listed in its registry entry; grant-widening requires a human admin action (logged, high-risk).
- **Every write path in every module** calls `can()` before mutating — enforced by convention + code review + a test helper that asserts denial for an unauthorized principal on each public API.

## Data model sketch

`users`, `organizations`, `org_memberships (user_id, org_id, org_role)`, `workspaces`, `teams` (P2), `team_members` (P2), `memberships (user_id, workspace_id, role)`, `invitations` (P2), `roles (built-in + future custom)`, `role_grants`, `field_masks`, `assistant_principals (id, org, name, created_by)`, `api_keys (hash, scopes, last_used)`.

Org-level roles (Org Owner / Org Admin) live in `org_memberships` and imply access across every workspace in the org (D-003 — "org-level roles above"); workspace `memberships` refine access within a workspace and can only narrow relative to the org role.

## Events emitted

`user.signed_up`, `user.signed_in`, `user.sign_in_failed`, `session.revoked`, `org.created`, `workspace.created`, `member.invited/joined/role_changed/removed`, `auth.permission_denied`, `api_key.created/revoked`.

## Phasing

- **P0:** GitHub OAuth sign-in; sign-in audit events (`user.signed_in`); org/workspace CRUD; seed roles (Org Owner, Member); `can()` v1 (action × scope); RLS integration with platform context; cross-tenant tests (second org via test factories). The tenancy hierarchy lives in the **schema** from P0 — org/workspace columns on every domain table, no retrofit risk (refines the master-plan v0.2 full-hierarchy note; see v0.5 changelog) — while team machinery and member-management UI wait for P2.
- **P1:** assistant principals + field masks (minimal: sensitivity-flag masking); deny-event emission.
- **P2:** design-partner multi-user readiness (D-017): Google OAuth + magic link, and the email+password vs magic-link-only decision (+ password reset/verification, `user.sign_in_failed` events, login rate limiting if credential login ships); teams + team-scoped grants; invitation flow/UI + member management; full role catalog (Org Admin, Workspace Admin, Manager, Guest); per-assistant grant editor UI; session security hardening (device list, revoke + `session.revoked` events).
- **P3+:** custom roles; SCIM/SSO exploration if enterprise demand.

## Open questions

- Should Guests be workspace-scoped share links or real memberships? (default: real memberships, read-only role).
- Does magic link replace email+password entirely at P2? (default: yes, unless a design partner requires passwords — one less credential surface to protect).

## Success criteria

- Cross-tenant and cross-workspace access attempts fail in CI tests (Phase 0 exit).
- An assistant principal with deals-read scope cannot read a sensitivity-masked field even when a tool requests it (P1 test).
- 100% of module write paths guarded by `can()` (checked by the shared test helper).
