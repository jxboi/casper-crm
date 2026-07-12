"use client";

import { create } from "zustand";
import type {
  AIMessage, Change, ChangeSet, Company, Contact, Deal, EmailDraft,
  FeedbackContext, FeedbackItem, FeedbackScreenshot, FeedbackStatus, FeedbackTarget,
  PlanStep, RunStatus, StageKey, Task, TimelineEvent, User,
} from "@/lib/types";
import { guardIssues, neglectReasons, stageOf } from "@/lib/pipeline";
import { COMPANIES, CONTACTS, DEALS, TASKS, TIMELINE, USERS } from "@/lib/seed";

const TODAY = "2026-07-12";

let nextId = 1000;
const uid = (prefix: string) => `${prefix}_${++nextId}`;

export type Toast = { id: number; kind: "ok" | "warn" | "err"; text: string };
let toastId = 0;

type DockTab = "conversation" | "plan" | "workspace" | "changes";

type Store = {
  users: User[];
  currentUserId: string;
  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
  tasks: Task[];
  timeline: TimelineEvent[];
  changeSets: ChangeSet[];
  drafts: EmailDraft[];
  feedback: FeedbackItem[];
  toasts: Toast[];

  dockOpen: boolean;
  dockTab: DockTab;
  run: {
    status: RunStatus;
    messages: AIMessage[];
    steps: PlanStep[];
    changeSetId: string | null;
  };

  setUser: (id: string) => void;
  toggleDock: (open?: boolean) => void;
  setDockTab: (tab: DockTab) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;

  transition: (dealId: string, to: StageKey, extras?: { lostReason?: string }) => { ok: boolean; issues: string[] };
  updateDealField: (dealId: string, key: "nextActionDate" | "expectedCloseDate" | "source", value: string, by?: { actorName: string; source: TimelineEvent["source"] }) => void;
  addTask: (dealId: string | null, title: string, dueDate: string, origin?: Task["origin"], assigneeId?: string) => void;
  toggleTask: (taskId: string) => void;

  submitFeedback: (input: {
    target: FeedbackTarget;
    body: string;
    action: string | null;
    screenshot: FeedbackScreenshot | null;
    capture: Pick<FeedbackContext, "route" | "screen" | "recordRef" | "recordLabel" | "workflowState">;
  }) => void;
  setFeedbackStatus: (id: string, status: FeedbackStatus) => void;
  mergeFeedback: (id: string, intoId: string) => void;

  startRun: () => void;
  answerClarify: (choice: string) => void;
  setChangeApproval: (changeSetId: string, changeId: string, approval: Change["approval"]) => void;
  setAllApprovals: (changeSetId: string, approval: Change["approval"]) => void;
  commitChangeSet: (changeSetId: string) => void;
};

export const useStore = create<Store>()((set, get) => {
  const pushEvent = (dealId: string, type: string, summary: string, actorName: string, source: TimelineEvent["source"]) => {
    set((s) => ({
      timeline: [...s.timeline, { id: uid("e"), dealId, type, summary, actorName, source, at: TODAY }],
    }));
  };
  const pushMessage = (msg: Omit<AIMessage, "id">) => {
    set((s) => ({ run: { ...s.run, messages: [...s.run.messages, { ...msg, id: uid("m") }] } }));
  };

  return {
    users: USERS,
    currentUserId: "u_amara",
    companies: COMPANIES,
    contacts: CONTACTS,
    deals: DEALS,
    tasks: TASKS,
    timeline: TIMELINE,
    changeSets: [],
    drafts: [],
    feedback: [],
    toasts: [],

    dockOpen: false,
    dockTab: "conversation",
    run: { status: "idle", messages: [], steps: [], changeSetId: null },

    setUser: (id) => set({ currentUserId: id }),
    toggleDock: (open) => set((s) => ({ dockOpen: open ?? !s.dockOpen })),
    setDockTab: (tab) => set({ dockTab: tab }),
    toast: (kind, text) => {
      const id = ++toastId;
      set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    transition: (dealId, to, extras) => {
      const s = get();
      const deal = s.deals.find((d) => d.id === dealId);
      if (!deal) return { ok: false, issues: ["Deal not found"] };
      const actor = s.users.find((u) => u.id === s.currentUserId)!;
      const issues = guardIssues(deal, to, actor.role, extras);
      if (issues.length) return { ok: false, issues };

      const from = deal.stage;
      set((st) => ({
        deals: st.deals.map((d) =>
          d.id === dealId
            ? {
                ...d,
                stage: to,
                stageEnteredAt: TODAY,
                lastActivityAt: TODAY,
                lostReason: to === "lost" ? (extras?.lostReason ?? d.lostReason) : d.lostReason,
              }
            : d
        ),
      }));
      pushEvent(dealId, "deal.stage_changed", `${stageOf(from).name} → ${stageOf(to).name}`, actor.name, "ui");

      // default automations from casper-sales config
      if (to === "won") {
        get().addTask(dealId, `Onboarding kickoff — ${deal.name}`, "2026-07-15", "automation", deal.ownerId);
        pushEvent(dealId, "automation.executed", "Won → onboarding kickoff task created", "workflow", "automation");
        get().toast("ok", "Automation: onboarding kickoff task created");
      }
      if (to === "lost") {
        pushEvent(dealId, "automation.executed", "Lost → owner’s manager notified (managerModel: workspace)", "workflow", "automation");
        get().toast("ok", "Automation: Jun Wei (Manager) notified");
      }
      return { ok: true, issues: [] };
    },

    updateDealField: (dealId, key, value, by) => {
      const s = get();
      const deal = s.deals.find((d) => d.id === dealId);
      if (!deal) return;
      const before = deal[key] ?? "—";
      set((st) => ({
        deals: st.deals.map((d) => (d.id === dealId ? { ...d, [key]: value, lastActivityAt: TODAY } : d)),
      }));
      const actor = by ?? { actorName: s.users.find((u) => u.id === s.currentUserId)!.name, source: "ui" as const };
      pushEvent(dealId, "record.updated", `${key} ${before} → ${value}`, actor.actorName, actor.source);
    },

    addTask: (dealId, title, dueDate, origin = "manual", assigneeId) => {
      const s = get();
      set((st) => ({
        tasks: [
          ...st.tasks,
          { id: uid("t"), title, dealId, assigneeId: assigneeId ?? s.currentUserId, dueDate, done: false, origin },
        ],
      }));
      if (dealId && origin === "manual") {
        pushEvent(dealId, "task.created", title, s.users.find((u) => u.id === s.currentUserId)!.name, "ui");
      }
    },

    toggleTask: (taskId) =>
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) })),

    /* ------------------------------------------------------------------
       casper-feedback P1 — contextual capture + triage.
       Capture emits feedback.submitted; a triage status change emits
       feedback.triaged. When the feedback points at a record, the event
       lands on that deal's timeline so it is visible in context (the P2
       "linked from record/timeline" seam). Themes/signals/proposals (P3)
       are out of scope here — the item just carries reserved themeId.
       ------------------------------------------------------------------ */
    submitFeedback: ({ target, body, action, screenshot, capture }) => {
      const s = get();
      const actor = s.users.find((u) => u.id === s.currentUserId)!;
      const dealId = capture.recordRef?.startsWith("deal:") ? capture.recordRef.slice(5) : null;
      const recentActivity = s.timeline
        .filter((e) => (dealId ? e.dealId === dealId : true))
        .slice(-3)
        .reverse()
        .map((e) => `${e.type} — ${e.summary}`);

      const item: FeedbackItem = {
        id: uid("fb"),
        target,
        body: body.trim(),
        screenshot,
        context: {
          ...capture,
          userRole: actor.role,
          userName: actor.name,
          action: action?.trim() || null,
          recentActivity,
        },
        status: "new",
        mergedInto: null,
        themeId: null,
        submittedById: actor.id,
        submittedAt: TODAY,
        updatedAt: TODAY,
      };

      set((st) => ({ feedback: [item, ...st.feedback] }));
      if (dealId) {
        pushEvent(
          dealId,
          "feedback.submitted",
          `Feedback on ${target.label.toLowerCase()}: “${item.body.slice(0, 80)}${item.body.length > 80 ? "…" : ""}”`,
          actor.name,
          "ui"
        );
      }
      get().toast("ok", "Feedback captured with full context — thank you");
    },

    setFeedbackStatus: (id, status) => {
      const s = get();
      const item = s.feedback.find((f) => f.id === id);
      if (!item || item.status === status) return;
      set((st) => ({
        feedback: st.feedback.map((f) => (f.id === id ? { ...f, status, updatedAt: TODAY } : f)),
      }));
      const dealId = item.context.recordRef?.startsWith("deal:") ? item.context.recordRef.slice(5) : null;
      if (dealId) {
        const actor = s.users.find((u) => u.id === s.currentUserId)!;
        pushEvent(dealId, "feedback.triaged", `Feedback → ${status}`, actor.name, "ui");
      }
    },

    mergeFeedback: (id, intoId) => {
      if (id === intoId) return;
      set((st) => ({
        feedback: st.feedback.map((f) =>
          f.id === id ? { ...f, mergedInto: intoId, status: "acknowledged", updatedAt: TODAY } : f
        ),
      }));
      get().toast("ok", "Merged as a duplicate — evidence stays linked");
    },

    /* ------------------------------------------------------------------
       Scripted assistant run — the M1 "first follow-up" demo slice.
       In the real product this is a Workflow DevKit run in casper-api
       streaming over SSE; here it is deterministic client-side theatre.
       The safety property it demonstrates is real, though: the run only
       ever produces a draft change set — commit is a human action.
       ------------------------------------------------------------------ */
    startRun: () => {
      const s = get();
      if (s.run.status !== "idle" && s.run.status !== "committed") {
        set({ dockOpen: true });
        return;
      }
      set({
        dockOpen: true,
        dockTab: "conversation",
        run: { status: "clarifying", messages: [], steps: [], changeSetId: null },
      });
      pushMessage({ role: "user", text: "Prepare follow-ups for my neglected deals." });
      setTimeout(() => {
        const st = get();
        const mine = st.deals.filter((d) => d.ownerId === st.currentUserId && neglectReasons(d).length > 0);
        const lines = mine
          .map((d) => `• ${d.name} — ${neglectReasons(d).join("; ")}`)
          .join("\n");
        pushMessage({
          role: "assistant",
          text: `I checked record.neglected signals on your pipeline and found ${mine.length} deals:\n${lines}\n\nShould I prepare follow-ups for all of them, or only what closes this month?`,
          chips: ["All of them", "Only closing this month"],
        });
      }, 800);
    },

    answerClarify: (choice) => {
      pushMessage({ role: "user", text: choice });
      const onlyThisMonth = choice.toLowerCase().includes("month");
      set((s) => ({ run: { ...s.run, status: "planning" } }));

      const steps: PlanStep[] = [
        { id: "s1", label: "Find neglected deals", detail: "record.neglected events + saved-view filter", status: "pending" },
        { id: "s2", label: "Review each timeline", detail: "last touch, open tasks, thread context", status: "pending" },
        { id: "s3", label: "Draft follow-up actions", detail: "tasks, next-action dates, email drafts", status: "pending" },
        { id: "s4", label: "Assemble change set", detail: "everything lands as drafts for your approval", status: "pending" },
      ];
      steps.forEach((step, i) => {
        setTimeout(() => {
          set((s) => ({ run: { ...s.run, steps: [...s.run.steps, step] } }));
        }, 350 * (i + 1));
      });
      setTimeout(() => {
        pushMessage({ role: "assistant", text: "Plan is up — working through it now. Follow along in the Plan tab." });
        set((s) => ({ run: { ...s.run, status: "working" } }));
      }, 350 * steps.length + 400);

      const markStep = (idx: number, status: PlanStep["status"]) =>
        set((s) => ({
          run: { ...s.run, steps: s.run.steps.map((st, i) => (i === idx ? { ...st, status } : st)) },
        }));
      const base = 350 * steps.length + 700;
      steps.forEach((_, i) => {
        setTimeout(() => {
          markStep(i, "active");
          if (i > 0) markStep(i - 1, "done");
        }, base + i * 650);
      });

      setTimeout(() => {
        markStep(steps.length - 1, "done");
        const st = get();
        let targets = st.deals.filter((d) => d.ownerId === st.currentUserId && neglectReasons(d).length > 0);
        if (onlyThisMonth) {
          targets = targets.filter((d) => d.expectedCloseDate?.startsWith("2026-07"));
        }

        const followUps: Record<string, { task: string; due: string; nextAction: string; draft?: Omit<EmailDraft, "id" | "dealId"> }> = {
          d_northwind: {
            task: "Call Daniel Ng — renewal decision after board meeting",
            due: "2026-07-14",
            nextAction: "2026-07-14",
            draft: {
              to: "daniel.ng@northwind.asia",
              subject: "Northwind renewal — picking up after your board meeting",
              body: "Hi Daniel,\n\nYou mentioned the board was meeting end of June — I wanted to pick this back up so the renewal doesn’t lapse on the 30 July date we discussed.\n\nWould a 20-minute call this week work to close out the two open commercial points?\n\nBest,\nAmara",
            },
          },
          d_meridian: {
            task: "Follow up on v2 proposal with Sarah",
            due: "2026-07-15",
            nextAction: "2026-07-15",
            draft: {
              to: "sarah@meridian.com.sg",
              subject: "Revised scope — anything else you need from us?",
              body: "Hi Sarah,\n\nJust checking in on the revised proposal I sent on 6 July — happy to walk your partners through the scoping changes if that helps.\n\nIs there anything blocking a decision on your side?\n\nBest,\nAmara",
            },
          },
          d_helios: {
            task: "Book pricing review call with Marcus (CFO)",
            due: "2026-07-16",
            nextAction: "2026-07-16",
          },
        };

        const changes: Change[] = [];
        const drafts: EmailDraft[] = [];
        for (const deal of targets) {
          const fu = followUps[deal.id];
          if (!fu) continue;
          changes.push({
            id: uid("ch"), op: "create_task", dealId: deal.id, dealName: deal.name,
            summary: `Task: “${fu.task}” · due ${fu.due}`,
            risk: "medium", approval: "pending",
            payload: { taskTitle: fu.task, dueDate: fu.due },
          });
          changes.push({
            id: uid("ch"), op: "update_field", dealId: deal.id, dealName: deal.name,
            summary: "next action date",
            before: deal.nextActionDate ?? "—", after: fu.nextAction,
            risk: "medium", approval: "pending",
            payload: { fieldKey: "nextActionDate", value: fu.nextAction },
          });
          if (fu.draft) {
            const draft: EmailDraft = { id: uid("dr"), dealId: deal.id, ...fu.draft };
            drafts.push(draft);
            changes.push({
              id: uid("ch"), op: "email_draft", dealId: deal.id, dealName: deal.name,
              summary: `Email draft to ${fu.draft.to} — “${fu.draft.subject}”`,
              risk: "low", approval: "pending",
              payload: { artifactId: draft.id },
            });
          }
        }

        const cs: ChangeSet = {
          id: uid("cs"),
          title: `Follow-ups for ${targets.length} neglected deal${targets.length === 1 ? "" : "s"}`,
          intent: "Prepare follow-ups for my neglected deals",
          authorName: "Sales Assistant",
          origin: "ai_run",
          status: "in_review",
          createdAt: TODAY,
          changes,
        };
        set((s) => ({
          drafts: [...s.drafts, ...drafts],
          changeSets: [...s.changeSets, cs],
          run: { ...s.run, status: "review", changeSetId: cs.id },
        }));
        pushMessage({
          role: "assistant",
          text: `Ready for review: ${changes.length} proposed changes across ${targets.length} deal${targets.length === 1 ? "" : "s"}${drafts.length ? `, with ${drafts.length} email drafts in the Workspace tab` : ""}.\n\nNothing has touched a record — approve what you want in Changes (or the Approvals inbox) and commit. Anything you reject stays a draft.`,
        });
        get().toast("ok", `Change set ready: ${changes.length} proposals awaiting review`);
      }, base + steps.length * 650 + 500);
    },

    setChangeApproval: (changeSetId, changeId, approval) =>
      set((s) => ({
        changeSets: s.changeSets.map((cs) =>
          cs.id === changeSetId
            ? { ...cs, changes: cs.changes.map((c) => (c.id === changeId ? { ...c, approval } : c)) }
            : cs
        ),
      })),

    setAllApprovals: (changeSetId, approval) =>
      set((s) => ({
        changeSets: s.changeSets.map((cs) =>
          cs.id === changeSetId ? { ...cs, changes: cs.changes.map((c) => ({ ...c, approval })) } : cs
        ),
      })),

    commitChangeSet: (changeSetId) => {
      const s = get();
      const cs = s.changeSets.find((c) => c.id === changeSetId);
      if (!cs || cs.status !== "in_review") return;
      const approved = cs.changes.filter((c) => c.approval === "approved");
      const rejected = cs.changes.filter((c) => c.approval !== "approved");

      for (const change of approved) {
        if (change.op === "create_task" && change.payload.taskTitle && change.payload.dueDate) {
          const deal = s.deals.find((d) => d.id === change.dealId);
          get().addTask(change.dealId, change.payload.taskTitle, change.payload.dueDate, "ai", deal?.ownerId);
          pushEvent(change.dealId, "task.created", `${change.payload.taskTitle} (via approved change set)`, "Sales Assistant", "ai");
        }
        if (change.op === "update_field" && change.payload.fieldKey && change.payload.value) {
          get().updateDealField(change.dealId, change.payload.fieldKey, change.payload.value, {
            actorName: "Sales Assistant",
            source: "ai",
          });
        }
        if (change.op === "email_draft") {
          pushEvent(change.dealId, "artifact.saved", change.summary, "Sales Assistant", "ai");
        }
      }
      set((st) => ({
        changeSets: st.changeSets.map((c) => (c.id === changeSetId ? { ...c, status: "committed" } : c)),
        run: st.run.changeSetId === changeSetId ? { ...st.run, status: "committed" } : st.run,
      }));
      get().toast(
        "ok",
        `Committed ${approved.length} change${approved.length === 1 ? "" : "s"}${rejected.length ? ` · ${rejected.length} rejected (stay drafts)` : ""} — fully audited`
      );
      if (s.run.changeSetId === changeSetId) {
        pushMessage({
          role: "assistant",
          text: `Committed ${approved.length} of ${cs.changes.length} changes. Timelines and the audit trail are updated — the rejected ones stay as drafts. I’ll nudge you when the next SLA scan flags anything new.`,
        });
      }
    },
  };
});

export function useCurrentUser() {
  return useStore((s) => s.users.find((u) => u.id === s.currentUserId)!);
}
