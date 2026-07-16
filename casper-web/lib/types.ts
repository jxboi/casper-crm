export type StageKey = "new" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
export type StageCategory = "open" | "won" | "lost";
export type Role = "member" | "manager";
export type Risk = "low" | "medium" | "high";

export type User = {
  id: string;
  name: string;
  initials: string;
  role: Role;
};

export type Company = {
  id: string;
  name: string;
  domain: string;
  industry: string;
  size: string;
  region: string;
};

export type Contact = {
  id: string;
  name: string;
  title: string;
  email: string;
  companyId: string;
};

export type Deal = {
  id: string;
  name: string;
  companyId: string;
  contactIds: string[];
  stage: StageKey;
  workflowVersion: number;
  /** integer minor units per D-012; null until qualified out */
  amount: number | null;
  currency: "SGD" | "USD";
  expectedCloseDate: string | null;
  nextActionDate: string | null;
  source: string;
  ownerId: string;
  lostReason: string | null;
  lastActivityAt: string;
  stageEnteredAt: string;
};

export type Task = {
  id: string;
  title: string;
  dealId: string | null;
  assigneeId: string;
  dueDate: string;
  done: boolean;
  origin: "manual" | "automation" | "ai";
};

export type TimelineEvent = {
  id: string;
  dealId: string;
  /** event name per D-012, e.g. deal.stage_changed */
  type: string;
  summary: string;
  actorName: string;
  source: "ui" | "automation" | "ai" | "system";
  at: string;
};

export type ChangeOp = "create_task" | "update_field" | "email_draft";

export type Change = {
  id: string;
  op: ChangeOp;
  dealId: string;
  dealName: string;
  summary: string;
  before?: string;
  after?: string;
  risk: Risk;
  approval: "pending" | "approved" | "rejected";
  payload: {
    taskTitle?: string;
    dueDate?: string;
    fieldKey?: "nextActionDate" | "expectedCloseDate";
    value?: string;
    artifactId?: string;
  };
};

export type ChangeSet = {
  id: string;
  title: string;
  intent: string;
  authorName: string;
  origin: "ai_run" | "manual";
  /** Mapped from the engine's richer status set: draft/in_review → in_review;
   *  approved (all decided, some approved) → approved; committing/committed →
   *  committed; rejected/rolled_back → rejected. See toWebChangeSet. */
  status: "in_review" | "approved" | "committed" | "rejected";
  createdAt: string;
  changes: Change[];
};

export type EmailDraft = {
  id: string;
  dealId: string;
  to: string;
  subject: string;
  body: string;
};

export type AIMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  chips?: string[];
};

export type PlanStep = {
  id: string;
  label: string;
  detail: string;
  status: "pending" | "active" | "done";
};

export type RunStatus = "idle" | "clarifying" | "planning" | "working" | "review" | "committed";

/* ---- casper-feedback (P1: contextual capture + triage) ---------------------
   Data model sketch from the plan:
   feedback_items (context, body, screenshot_ref, status, theme_id).
   theme_id / signals / proposals are P3 — reserved but unused here. */

export type FeedbackStatus = "new" | "acknowledged" | "planned" | "done";

/** What the feedback points at — user picks, or defaults to the page. */
export type FeedbackTargetKind = "page" | "field" | "button" | "stage" | "view" | "record";

export type FeedbackTarget = {
  kind: FeedbackTargetKind;
  label: string;
};

/** Auto-captured where work happens — no user effort (success criterion P1). */
export type FeedbackContext = {
  /** current route, e.g. /deals/d_northwind */
  route: string;
  /** human screen label, e.g. "Deal · Northwind Renewal" */
  screen: string;
  /** RecordRef per D-012, e.g. "deal:d_northwind"; null off-record */
  recordRef: string | null;
  recordLabel: string | null;
  /** workflow state, e.g. "deal-pipeline v4 · Negotiation" */
  workflowState: string | null;
  userRole: Role;
  userName: string;
  /** action being attempted, if the user names one */
  action: string | null;
  /** recent activity refs — event summaries near the moment of feedback */
  recentActivity: string[];
};

/** Optional screenshot blob (P1). Held as a data URL for the demo session. */
export type FeedbackScreenshot = {
  name: string;
  dataUrl: string;
};

export type FeedbackItem = {
  id: string;
  target: FeedbackTarget;
  body: string;
  screenshot: FeedbackScreenshot | null;
  context: FeedbackContext;
  status: FeedbackStatus;
  /** dedupe-merge: id of the item this was folded into (P1 triage) */
  mergedInto: string | null;
  /** P3 clustering — reserved, always null in P1 */
  themeId: string | null;
  submittedById: string;
  submittedAt: string;
  updatedAt: string;
};
