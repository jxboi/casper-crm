# casper-comms — Plan

**Status:** Draft v0.1 | **Layer:** Engine (integration) | **Phases:** 1 (drafts) → 2 (OAuth send) → 3/4 (ingestion, calendar) | **Depends on:** casper-records, casper-events, casper-changesets, casper-platform (crypto, blobs) | **Used by:** casper-ai (draft_email tool), casper-sales, casper-web | **Aligned with:** master-plan v0.3 (D-006, D-007, D-016, D-017, D-019)

## Purpose

Email as a first-class citizen of the CRM — first as an *output* (assistant-drafted follow-ups a human approves and sends), later as an *input* (the reference doc's "email and chat become inputs": threads auto-associated to records, decisions and action items extracted into proposed updates). External communication is permanently **high-risk** (D-007): nothing sends without explicit per-message human approval.

## Scope

**In**
- **P1 — drafts only:** `EmailDraft` artifacts (to/cc/subject/body, linked RecordRefs) produced by users or the assistant's `draft_email` tool; stored as change-set artifacts; UX: copy-to-clipboard / `mailto:` handoff; optional "mark as sent" logs a timeline activity. Zero deliverability risk, product fully usable.
- **P2 — connected mailbox send:** per-user `MailboxConnection` (Gmail API + Microsoft Graph), OAuth tokens sealed via platform crypto (D-016); send-on-approval flow: draft → change-set approval (`require_every_time`, non-negotiable for external sends) → send via user's own mailbox (authentic sender, real deliverability) → store message id/thread id → `email.sent` event → timeline. Failure handling (revoked token, quota) with clear user recovery. **Dogfood path (D-017):** the Gmail integration runs as an *unverified test-mode OAuth app* — the founder is a registered test user (Google allows ≤100), so no CASA verification is needed to dogfood real sends.
- **P2 — compliance track:** Google restricted-scope verification (CASA assessment — months of lead time) starts **only once design partners commit**; until then test-mode covers dogfooding and draft-only covers everyone else. Microsoft Graph consent is simpler and remains the likely first externally-shippable provider (Q-7, reframed in master-plan v0.2).
- **P3 — inbound sync:** incremental sync (Gmail history API / Graph delta) of connected mailboxes, running as cron-triggered Workflow DevKit workflows with per-mailbox steps (D-019); **association engine:** match participants → contacts (email), infer company (domain), link to open deals (participants + recency heuristics); unmatched → suggestion inbox, never silent auto-create; `email.received` events → record timelines. Org-level privacy controls: per-user opt-in, domain excludelists, subject-only mode (D-016/PDPA).
- **P3 — extraction:** AI (run in casper-ai) reads new thread content and proposes — through change sets — field updates (e.g. next-action date), tasks (action items), stage-relevant notes ("decision detected"). Same approval mechanics as everything else; recurring-discussion detection feeds casper-feedback (P4).
- **P4 — calendar:** meeting sync + association (same engine), meeting-prep context for the assistant. Slack/Teams explicitly future (casper-integrations).

**Out**
- System/transactional mail (platform `systemMail`), notification emails (casper-events), marketing/bulk email (never in scope — different product + compliance class), chat integrations (future module).

## Key design points

- **User's own mailbox, not a sending domain:** sales follow-ups must come from the rep's real address (deliverability + authenticity). We are not an ESP.
- **Send is a change-set commit side-effect with its own final gate:** approval commits the change set; the send action executes with idempotency key + immediately-before-send policy re-check (token still valid, recipient unchanged since approval).
- **Ingested content is untrusted data** (D-016): email bodies are prime prompt-injection vectors; they enter AI context only as delimited data blocks, and extraction outputs are proposals requiring approval — an email can never instruct the assistant into an unapproved action.
- **Association is suggest-first:** wrong auto-links destroy trust in the timeline; heuristics propose, users confirm, confirmations train the org's rules (simple weights, not ML, until scale demands).

## Data model sketch

`mailbox_connections (user, provider, sealed_tokens, scopes, sync_state, status)`, `email_messages (message_id, thread_id, direction, participants, subject, body_ref (blob), sent/received_at)`, `email_associations (message ↔ RecordRef, source: rule|user|ai, confidence)`, `email_drafts` (as change-set artifacts), `association_suggestions`.

## Events emitted

`email.draft_created`, `email.sent`, `email.send_failed`, `email.received`, `email.associated`, `mailbox.connected/disconnected/sync_failed`.

## Phasing

(see Scope — phases are the structure of this module)

## Open questions

- Q-7 (master, reframed v0.2): external provider priority decided when design partners are known — dogfooding runs on Gmail test-mode meanwhile; Microsoft remains the likely first verified provider.
- Store full bodies vs headers+snippet with on-demand fetch (default: full body in blob with org retention policy; revisit for PDPA data-minimization).
- Reply handling in P2 (threading a reply to a prior sent message) — likely trivial via provider thread id; confirm.

## Success criteria

- P1: assistant-drafted follow-up reaches the user's email client in ≤ 2 clicks; draft content matches what was approved, verbatim.
- P2: zero sends without an explicit approval record (audit-verifiable); token revocation degrades gracefully to draft-only with clear messaging.
- P3: ≥ 80% of inbound emails from known contacts auto-associate correctly (measured against user corrections); mis-association correctable in one click and remembered.
