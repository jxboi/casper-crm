# AI Strategy for an Adaptive CRM and Workflow Platform

## Vision

Create a business workflow platform where every user has access to a permissioned AI colleague. The AI should understand context, perform multi-step work, propose concrete changes, and update live data only after appropriate human approval.

The product combines two capabilities:

- **Operational assistance:** help users complete CRM and workflow tasks.
- **Workflow evolution:** detect friction, workarounds, and repeated manual effort, then propose safe improvements.

> A CRM that helps people do the work and evolves safely with how their team actually works.

## Principles

- Human control for important decisions
- Least-privilege access
- Structured, visible work instead of opaque reasoning
- Risk-proportional approvals
- Tool-mediated actions; never unrestricted database access
- Isolated execution before production mutation
- Versioning, auditability, and rollback
- Complete manual fallback
- Autonomy that reduces bureaucracy rather than recreating it

## Assistant identity and permissions

Treat each assistant as a governed digital worker with:

- identity, role, and purpose;
- data scope and field-level access;
- permitted tools and actions;
- approval requirements;
- record, time, monetary, and AI-budget limits;
- execution workspace and audit history.

Permissions must be enforced by the platform, not inferred by the model. Scope access by organisation, workspace, team, ownership, record type, and sensitive fields. Separate read, draft, create, update, transition, send, delete, and approve permissions.

Example:

```text
Assistant: Sales Operations Agent
Can read: accounts, deals, activities
Can create: tasks, drafts, proposed updates
Cannot: delete records, close deals, issue refunds
Approval required: external messages, financial changes, workflow publication
```

## Standard AI work cycle

```text
Request → Clarify → Plan → Review → Execute in workspace
→ Preview → Approve/edit/reject → Commit → Audit and measure
```

1. **Request:** user describes the desired outcome naturally.
2. **Clarify:** assistant asks only questions that materially affect the result and states safe assumptions.
3. **Plan:** assistant shows scope, steps, records, tools, and expected outputs.
4. **Review:** user can approve, narrow, edit, or cancel the plan.
5. **Execute:** work occurs against temporary state, leaving production untouched.
6. **Preview:** show outputs, affected records, warnings, conflicts, and exact diffs.
7. **Approve:** approve all, approve selected changes, revise, or reject.
8. **Commit:** apply only approved changes, safely and atomically where possible.
9. **Audit:** record the request, data accessed, tools used, proposed changes, approvals, commits, and outcomes.

## Transactional workspace and change-set model

The assistant should work in a temporary copy or overlay of relevant data:

```text
Current workspace → AI branch → diff → review → merge
```

Live records remain unchanged until approval. The workspace supports validation, conflict detection, generated files, drafts, and rollback. Every run produces a structured change set:

```json
{
  "request": "Prepare follow-ups for overdue opportunities",
  "status": "awaiting-approval",
  "changes": [
    {"type": "create-task", "recordId": "deal-1042", "risk": "low"},
    {"type": "update-field", "recordId": "deal-1042", "field": "nextActionDate", "risk": "medium"},
    {"type": "send-email", "recordId": "deal-1042", "status": "draft-only", "risk": "high"}
  ]
}
```

## Approval by risk

### Low risk

Search, read, summarise, group, draft, report, and recommend. These may run automatically or be batched into one review.

### Medium risk

Create tasks, update ordinary fields, change ownership, modify dates, and move records through normal stages. Require preview before commit.

### High risk

Send external messages, delete data, change permissions, approve payments, alter contracts or financial data, publish workflows, or perform irreversible actions. Require explicit approval immediately before execution.

Support standing policies such as **always allow**, **allow within limits**, **batch review**, **require every time**, and **never allow**. Policies must not silently expand permissions.

## Tool-mediated actions

The model chooses tools; the platform decides whether execution is valid. Example tools:

- `search_records`
- `read_record`
- `summarize_activity`
- `create_task_proposal`
- `update_record_proposal`
- `draft_email`
- `simulate_workflow_transition`
- `create_change_set`
- `request_approval`
- `commit_approved_changes`

Every tool validates inputs, enforces tenant and role permissions, applies risk controls, returns structured results, logs activity, and supports safe retries. The assistant must not generate arbitrary SQL or mutate production data directly.

## Specialized assistants

- **Personal work assistant:** follow-ups, tasks, record updates, summaries, drafts.
- **Sales operations assistant:** neglected opportunities, missing data, forecasts, ownership suggestions.
- **Customer onboarding assistant:** missing documents, onboarding tasks, reminders, blocked accounts.
- **Workflow improvement assistant:** feedback clustering, workaround detection, workflow proposals, simulations, and rollout plans.

All assistants share infrastructure but have distinct tools, data scopes, and approval policies.

## Manual fallback and interface

AI should accelerate work, not replace direct UI. Simple actions such as status changes should remain one-click. AI is best for multi-step, repetitive, context-heavy, cross-record, drafting, and judgment-based work.

The main experience should contain four persistent surfaces:

1. **Conversation:** requests and clarification.
2. **Plan:** scope, assumptions, tools, and steps.
3. **Workspace:** temporary files, drafts, reports, and outputs.
4. **Changes:** record-level diffs, warnings, approvals, and commit status.

## Architecture

### Shared business engine

Identity, tenants, roles, records, relationships, workflows, tasks, forms, views, notifications, files, integrations, background jobs, audit logs, and observability.

### AI orchestration layer

Context retrieval, intent detection, clarification, plan generation, tool selection, risk classification, approval-policy evaluation, workspace management, change-set generation, diffing, commit, and rollback.

### Product experience layer

Chat, plan review, approval panels, change previews, assistant administration, policies, feedback capture, and workflow-improvement tools.

### Safety layer

Tenant isolation, field-level permissions, tool allowlists, prompt/action audit, retention controls, rate limits, model versioning, conflict detection, and recovery.

## Adaptive workflow loop

```text
User asks AI to work
→ AI encounters friction or a workaround
→ System records the pattern
→ Similar patterns are grouped
→ Improvement is proposed
→ Historical simulation and shadow mode run
→ Human approves a pilot
→ Change rolls out gradually
→ Outcome is measured
```

The operational assistant and workflow-improvement assistant should use the same workflow context and event data.

## Rollout roadmap

### Phase 0 — Foundations

Define the first workflow, customer segment, tenant model, permission model, audit events, controlled tools, risk classes, and transactional workspace.

### Phase 1 — Narrow assistant MVP

Build one sales follow-up assistant that finds inactive deals, reads activity, summarises context, drafts emails, proposes tasks and field updates, previews changes, and commits approved work.

### Phase 2 — Safety and policy controls

Add standing approvals, batch/selective approval, conflict detection, rollback, usage limits, and persistent workspaces.

### Phase 3 — Workflow improvement

Add contextual feedback, repeated-action and export detection, feedback clustering, change proposals, simulation, shadow mode, and pilot rollout.

### Phase 4 — Expansion

Add onboarding and service assistants, email/calendar ingestion, document extraction, APIs, webhooks, and reusable industry templates.

## Metrics

### User value

- Time saved per workflow
- Manual actions removed
- Task and follow-up completion
- Approval turnaround time
- Workflow cycle time
- Reduction in spreadsheet/chat workarounds

### AI quality

- Successful completion rate
- Clarification usefulness
- Plan approval rate
- Change acceptance rate
- User edit rate
- Rejection and rollback rate
- Tool and invalid-action error rate

### Trust and safety

- Permission-denial correctness
- Unapproved mutations — target zero
- External-message approval compliance
- Audit completeness
- Conflict detection and recovery performance

### Adoption and business

- Weekly active AI users
- Repeat usage per user
- Share of eligible work initiated through AI
- Pilot-to-paid conversion
- Retention and expansion into additional assistants

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Excessive confirmation | Risk-based checkpoints, batching, and bounded standing policies |
| Harmful automation | Least privilege, structured tools, previews, approval, transaction boundaries, rollback |
| Poor context | Retrieve workflow, role, record, and activity context; expose assumptions |
| Chat replacing good UI | Keep direct manipulation for simple actions |
| Permission leakage | Enforce access in every tool and test tenant isolation |
| Non-deterministic execution | Deterministic rules, idempotent jobs, versioned prompts/models |
| Model/provider failure | Full manual fallback, retries, provider abstraction, safe intermediate state |
| Privacy/compliance exposure | Minimise data, encrypt, define retention, restrict tools, review PDPA obligations |

## MVP scope

### Include

- Responsive web app
- One overdue-opportunity workflow
- Workspace membership and role-based permissions
- One personal sales assistant
- Five to ten controlled tools
- Request, clarify, plan, review, execute, preview, approve, and commit flow
- Transactional workspace/change branch
- Task, field-update, and email-draft proposals
- Record-level change-set preview
- Selective and all-or-nothing approval
- Complete audit trail
- Manual equivalent for every supported action
- Basic metrics, logging, and error monitoring

### Defer

Fully autonomous external communication, broad multi-agent orchestration, universal workflow generation, many industry products, a large integration marketplace, complex native mobile apps, automatic workflow rewriting, and high-risk financial or destructive actions.

## Strategic conclusion

This should not be a conventional CRM with a chatbot attached. It should be a governed operating environment for human and AI work.

The defensible combination is workflow context, permissioned assistants, controlled tools, transactional execution, structured change sets, human approval, auditability, manual fallback, and continuous workflow improvement.

Start with one assistant and one valuable workflow. Prove that users trust the assistant to prepare real work, review it quickly, and produce reliable improvements before expanding the platform.
