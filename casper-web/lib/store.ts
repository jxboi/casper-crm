"use client";

import { create } from "zustand";
import type {
  AIMessage, ChangeSet, Company, Contact, Deal, EmailDraft,
  FeedbackContext, FeedbackItem, FeedbackScreenshot, FeedbackStatus, FeedbackTarget,
  PlanStep, RunStatus, StageKey, Task, TimelineEvent, User,
} from "@/lib/types";
import { guardIssues, neglectReasons, stageOf } from "@/lib/pipeline";
import { COMPANIES, CONTACTS, DEALS, TASKS, TIMELINE, USERS } from "@/lib/seed";
import { loadNeglectedDeals, type NeglectedDeal } from "@/lib/server/actions";
import {
  approveAllAction,
  approveChangeAction,
  commitChangeSetAction,
  countPendingApprovals,
  getWebChangeSet,
  rejectAllAction,
  rejectChangeAction,
} from "@/lib/server/changesets";

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
  drafts: EmailDraft[];
  feedback: FeedbackItem[];
  toasts: Toast[];
  /** In-review/approved change-set count for the nav badge (engine-backed). */
  pendingApprovals: number;

  dockOpen: boolean;
  dockTab: DockTab;
  run: {
    status: RunStatus;
    messages: AIMessage[];
    steps: PlanStep[];
    changeSetId: string | null;
    /** The run's live change set, fetched from the engine (source of truth). */
    changeSet: ChangeSet | null;
    /** Real neglected deals loaded from the engine when the run starts. */
    neglected: NeglectedDeal[];
  };
  /** Change-set id currently being committed to the engine (guards double-commit). */
  committing: string | null;

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
  /** Approve/reject a single change of the run's change set (engine-backed). */
  reviewRunChange: (changeId: string, decision: "approved" | "rejected") => Promise<void>;
  /** Approve/reject every pending change of the run's change set. */
  reviewAllRun: (decision: "approved" | "rejected") => Promise<void>;
  /** Commit the run's approved changes through the engine. */
  commitRunChangeSet: () => Promise<void>;
  /** Refresh the nav's pending-approvals badge from the engine. */
  refreshApprovalsCount: () => Promise<void>;
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
    drafts: [],
    feedback: [],
    toasts: [],
    pendingApprovals: 0,

    dockOpen: false,
    dockTab: "conversation",
    run: { status: "idle", messages: [], steps: [], changeSetId: null, changeSet: null, neglected: [] },
    committing: null,

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
       Assistant run — the M1 "first follow-up" slice. The conversation /
       plan pacing is still client-side theatre (the real product runs this
       as a Workflow DevKit run in casper-api streaming over SSE — D-019),
       but the *data* is real now: the run reads neglected deals from the
       engine and its committed changes are written through the engine's
       single write path (see `commitChangeSet`). The safety property is
       genuine: the run only ever produces a draft change set — commit is a
       human action, and until then nothing has touched a record.
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
        run: { status: "clarifying", messages: [], steps: [], changeSetId: null, changeSet: null, neglected: [] },
      });
      pushMessage({ role: "user", text: "Prepare follow-ups for my neglected deals." });

      void (async () => {
        let neglected: NeglectedDeal[];
        try {
          neglected = await loadNeglectedDeals();
        } catch {
          pushMessage({
            role: "assistant",
            text: "I couldn't reach the pipeline just now — give it a moment and try again.",
          });
          set((st) => ({ run: { ...st.run, status: "idle" } }));
          return;
        }

        if (neglected.length === 0) {
          pushMessage({
            role: "assistant",
            text: "Good news — none of your open deals are showing neglect signals right now, so there's nothing to prepare.",
          });
          set((st) => ({ run: { ...st.run, status: "committed" } }));
          return;
        }

        const lines = neglected
          .map((n) => `• ${n.deal.name} — ${neglectReasons(n.deal).join("; ")}`)
          .join("\n");
        set((st) => ({ run: { ...st.run, neglected } }));
        pushMessage({
          role: "assistant",
          text: `I checked record.neglected signals on your pipeline and found ${neglected.length} deal${neglected.length === 1 ? "" : "s"}:\n${lines}\n\nShould I prepare follow-ups for all of them, or only what closes this month?`,
          chips: ["All of them", "Only closing this month"],
        });
      })();
    },

    answerClarify: (choice) => {
      pushMessage({ role: "user", text: choice });
      const onlyThisMonth = choice.toLowerCase().includes("month");
      set((s) => ({ run: { ...s.run, status: "planning", steps: [] } }));

      // The clarify choice shapes the request; the real casper-ai run decides the rest.
      const request = onlyThisMonth
        ? "Prepare follow-ups for my neglected deals, but only the ones closing this month."
        : "Prepare follow-ups for all of my neglected deals.";

      const mapStatus = (s: string): RunStatus =>
        s === "planning" ? "planning" : s === "preview_ready" ? "review" : s === "failed" ? "idle" : "working";

      // Project a streamed RunEvent onto the dock's state. The audit record lives in the
      // engine (ai_run_steps); this is just the live view the four surfaces render.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onEvent = (e: any) => {
        switch (e.type) {
          case "run_started":
            set((s) => ({ run: { ...s.run, changeSetId: null, changeSet: null } }));
            break;
          case "plan_ready":
            set((s) => ({ run: { ...s.run, status: "working", steps: e.plan.steps as PlanStep[] } }));
            break;
          case "plan_step":
            set((s) => ({
              run: { ...s.run, steps: s.run.steps.map((st) => (st.id === e.stepId ? { ...st, status: e.status } : st)) },
            }));
            break;
          case "message":
            pushMessage({ role: "assistant", text: e.text });
            break;
          case "artifact":
            if (e.artifact?.kind === "email_draft") {
              set((s) => ({
                drafts: [
                  ...s.drafts,
                  { id: uid("dr"), dealId: e.artifact.dealId, to: e.artifact.to ?? "", subject: e.artifact.subject, body: e.artifact.body },
                ],
              }));
            }
            break;
          case "status":
            set((s) => ({ run: { ...s.run, status: mapStatus(e.status) } }));
            break;
          case "preview_ready":
            set((s) => ({ run: { ...s.run, status: "review", changeSetId: e.changesetId } }));
            void (async () => {
              const cs = await getWebChangeSet(e.changesetId);
              if (cs) set((s) => ({ run: { ...s.run, changeSet: cs } }));
              pushMessage({
                role: "assistant",
                text: `Ready for review: ${e.changeCount} proposed change${e.changeCount === 1 ? "" : "s"}.\n\nNothing has touched a record — this is a real, staged change set in the engine. Approve what you want in Changes (or the Approvals inbox) and commit; anything you reject stays unapplied.`,
              });
              get().toast("ok", `Change set ready: ${e.changeCount} proposal${e.changeCount === 1 ? "" : "s"} awaiting review`);
              void get().refreshApprovalsCount();
            })();
            break;
          case "error":
            pushMessage({ role: "assistant", text: `I hit a problem running that: ${e.message}` });
            set((s) => ({ run: { ...s.run, status: "idle" } }));
            get().toast("err", "The assistant run failed — nothing was staged.");
            break;
        }
      };

      void (async () => {
        let res: Response;
        try {
          res = await fetch("/api/ai/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assistantKey: "sales-followup", request }),
          });
        } catch {
          onEvent({ type: "error", message: "couldn't reach the run engine" });
          return;
        }
        if (!res.ok || !res.body) {
          onEvent({ type: "error", message: `run endpoint returned ${res.status}` });
          return;
        }
        // Parse the SSE stream frame by frame (data: <json>\n\n).
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (!frame.startsWith("data:")) continue;
            const line = frame.slice(5).trim();
            if (!line) continue;
            let e: unknown;
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            if ((e as { type?: string }).type === "done") continue;
            onEvent(e);
          }
        }
      })();
    },

    reviewRunChange: async (changeId, decision) => {
      const csId = get().run.changeSetId;
      if (!csId) return;
      try {
        const changeSet =
          decision === "approved"
            ? await approveChangeAction(csId, changeId)
            : await rejectChangeAction(csId, changeId);
        set((s) => ({ run: { ...s.run, changeSet } }));
      } catch {
        get().toast("err", "Couldn't record that decision — try again.");
      }
    },

    reviewAllRun: async (decision) => {
      const csId = get().run.changeSetId;
      if (!csId) return;
      try {
        const changeSet =
          decision === "approved" ? await approveAllAction(csId) : await rejectAllAction(csId);
        set((s) => ({ run: { ...s.run, changeSet } }));
      } catch {
        get().toast("err", "Couldn't update the change set — try again.");
      }
    },

    /* ------------------------------------------------------------------
       Commit through the real casper-changesets engine (D-006). The approved
       subset is applied via the records write path under the system principal,
       every event stamped causationId = changeset — so the deal timelines +
       audit trail attribute the writes to this run. A stale base version (a
       concurrent edit) comes back as an issue for re-review, never a clobber.
       ------------------------------------------------------------------ */
    commitRunChangeSet: async () => {
      const s = get();
      const csId = s.run.changeSetId;
      if (!csId || s.committing) return;

      set({ committing: csId });
      let result;
      try {
        result = await commitChangeSetAction(csId);
      } catch {
        set({ committing: null });
        get().toast("err", "Commit failed — nothing was written. Try again.");
        return;
      }
      set({ committing: null });

      set((st) => ({
        run: {
          ...st.run,
          changeSet: result.changeSet,
          status: result.ok ? "committed" : st.run.status,
        },
      }));

      const applied = result.changeSet.changes.filter((c) => c.approval === "approved").length;
      const rejected = result.changeSet.changes.filter((c) => c.approval === "rejected").length;
      if (result.ok) {
        get().toast(
          "ok",
          `Committed ${applied} change${applied === 1 ? "" : "s"} through the engine${rejected ? ` · ${rejected} rejected` : ""} — fully audited`
        );
        pushMessage({
          role: "assistant",
          text: `Committed ${applied} of ${result.changeSet.changes.length} changes through the engine — the deal timelines and audit trail now show them, attributed to this run.${rejected ? ` The ${rejected} you rejected were left unapplied.` : ""} I'll nudge you when the next SLA scan flags anything new.`,
        });
      } else {
        get().toast("warn", result.issues[0] ?? "Some changes couldn't be committed — re-review needed");
      }
      void get().refreshApprovalsCount();
    },

    refreshApprovalsCount: async () => {
      try {
        set({ pendingApprovals: await countPendingApprovals() });
      } catch {
        // Best-effort nav badge; a transient failure just leaves the last count.
      }
    },
  };
});

export function useCurrentUser() {
  return useStore((s) => s.users.find((u) => u.id === s.currentUserId)!);
}
