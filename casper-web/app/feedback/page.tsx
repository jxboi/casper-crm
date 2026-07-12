"use client";

import { useMemo, useState } from "react";
import { Layers, MapPin, MessageSquarePlus, Paperclip, User, Workflow } from "lucide-react";
import { useStore, useCurrentUser } from "@/lib/store";
import { FEEDBACK_STATUSES, STATUS_LABEL, STATUS_TONE } from "@/lib/feedback";
import { dateShort } from "@/lib/format";
import type { FeedbackItem, FeedbackStatus } from "@/lib/types";
import { PageHeader } from "@/components/page-header";

type Filter = "all" | FeedbackStatus;

function ContextChips({ item }: { item: FeedbackItem }) {
  const c = item.context;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-faint">
      <span className="flex items-center gap-1">
        <MapPin size={11} /> {c.screen}
      </span>
      {c.recordRef && <span>{c.recordRef}</span>}
      {c.workflowState && (
        <span className="flex items-center gap-1">
          <Workflow size={11} /> {c.workflowState}
        </span>
      )}
      <span className="flex items-center gap-1">
        <User size={11} /> {c.userName} · {c.userRole}
      </span>
      {item.screenshot && (
        <span className="flex items-center gap-1">
          <Paperclip size={11} /> {item.screenshot.name}
        </span>
      )}
    </div>
  );
}

function FeedbackCard({
  item,
  duplicates,
  canTriage,
  mergeTargets,
}: {
  item: FeedbackItem;
  duplicates: FeedbackItem[];
  canTriage: boolean;
  mergeTargets: FeedbackItem[];
}) {
  const setFeedbackStatus = useStore((s) => s.setFeedbackStatus);
  const mergeFeedback = useStore((s) => s.mergeFeedback);

  return (
    <div className="rise rounded-xl border border-line bg-panel p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex w-fit items-center rounded-full bg-panel-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
            {item.target.kind} · {item.target.label}
          </span>
        </div>
        {canTriage ? (
          <div className="flex flex-none gap-1">
            {FEEDBACK_STATUSES.map((st) => (
              <button
                key={st}
                onClick={() => setFeedbackStatus(item.id, st)}
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${
                  item.status === st ? STATUS_TONE[st] : "text-faint hover:text-muted"
                }`}
              >
                {STATUS_LABEL[st]}
              </button>
            ))}
          </div>
        ) : (
          <span className={`flex-none rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${STATUS_TONE[item.status]}`}>
            {STATUS_LABEL[item.status]}
          </span>
        )}
      </div>

      <p className="mt-2.5 whitespace-pre-wrap text-[13.5px] leading-relaxed">{item.body}</p>
      {item.context.action && (
        <p className="mt-1 text-[12px] text-muted">
          <span className="text-faint">trying to:</span> {item.context.action}
        </p>
      )}

      {item.context.recentActivity.length > 0 && (
        <div className="mt-2.5 rounded-lg border border-line bg-panel-2/30 px-3 py-2">
          <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">recent activity captured</p>
          <ul className="flex flex-col gap-0.5">
            {item.context.recentActivity.map((a, i) => (
              <li key={i} className="truncate font-mono text-[11px] text-muted">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <ContextChips item={item} />
        <span className="font-mono text-[10.5px] text-faint">{dateShort(item.submittedAt)}</span>
      </div>

      {duplicates.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
            <Layers size={11} /> {duplicates.length} merged duplicate{duplicates.length === 1 ? "" : "s"}
          </p>
          <ul className="flex flex-col gap-1">
            {duplicates.map((d) => (
              <li key={d.id} className="truncate text-[12px] text-muted">
                · {d.body} <span className="font-mono text-[10px] text-faint">— {d.context.userName}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canTriage && mergeTargets.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">merge as duplicate of</label>
          <select
            value=""
            onChange={(e) => e.target.value && mergeFeedback(item.id, e.target.value)}
            className="max-w-[220px] rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-muted"
          >
            <option value="">choose…</option>
            {mergeTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.body.slice(0, 48)}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export default function FeedbackPage() {
  const feedback = useStore((s) => s.feedback);
  const user = useCurrentUser();
  const canTriage = user.role === "manager";
  const [filter, setFilter] = useState<Filter>("all");

  // Members see only their own feedback (plan default: submitters see own status;
  // the triage board is admin-only until trust is established).
  const visible = useMemo(
    () => (canTriage ? feedback : feedback.filter((f) => f.submittedById === user.id)),
    [feedback, canTriage, user.id]
  );

  const roots = visible.filter((f) => !f.mergedInto);
  const duplicatesOf = (id: string) => feedback.filter((f) => f.mergedInto === id);

  const counts = useMemo(() => {
    const base: Record<Filter, number> = { all: roots.length, new: 0, acknowledged: 0, planned: 0, done: 0 };
    for (const f of roots) base[f.status] += 1;
    return base;
  }, [roots]);

  const shown = filter === "all" ? roots : roots.filter((f) => f.status === filter);
  const mergeTargets = (id: string) => roots.filter((f) => f.id !== id);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    ...FEEDBACK_STATUSES.map((s) => ({ key: s as Filter, label: STATUS_LABEL[s] })),
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader kicker="casper-feedback · P1 capture → triage" title={canTriage ? "Feedback triage" : "My feedback"}>
        <p className="max-w-[40ch] text-right text-[12px] text-muted">
          {canTriage
            ? "Every item lands with full context attached — route, record, role, recent activity. Merge duplicates; set status."
            : "Your submissions and where they stand. The triage board is admin-only for now."}
        </p>
      </PageHeader>

      <div className="flex flex-wrap gap-1.5 px-6 pb-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] ${
              filter === f.key ? "bg-ink text-panel" : "border border-line text-muted hover:border-line-strong"
            }`}
          >
            {f.label}
            <span className="font-mono text-[10.5px] opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-16 text-center">
            <MessageSquarePlus size={22} className="text-faint" />
            <p className="text-[13px] text-muted">
              {roots.length === 0 ? "No feedback yet." : "Nothing in this status."}
            </p>
            <p className="max-w-[34ch] text-[12px] text-faint">
              Use the feedback button (bottom-right) on any screen — context is captured for you.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {shown.map((item) => (
              <FeedbackCard
                key={item.id}
                item={item}
                duplicates={duplicatesOf(item.id)}
                canTriage={canTriage}
                mergeTargets={mergeTargets(item.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
