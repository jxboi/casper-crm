"use client";

import { Check, ListChecks, Mail, PencilLine, X } from "lucide-react";
import type { Change, ChangeSet } from "@/lib/types";

const OP_ICON = { create_task: ListChecks, update_field: PencilLine, email_draft: Mail } as const;
const OP_LABEL = { create_task: "create task", update_field: "update field", email_draft: "email draft" } as const;

/**
 * The trust surface (D-006): a change set rendered as per-change before/after with
 * per-change approve/reject and a commit action. It is **presentational** — the caller
 * (dock run or Approvals inbox) supplies handlers that drive the real engine and hands
 * back a refreshed change set. When no handlers are given (committed history), it renders
 * read-only. Engine review is one-way: clicking the already-active decision is a no-op.
 */
export interface DiffViewerHandlers {
  onApprove: (changeId: string) => void;
  onReject: (changeId: string) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onCommit: () => void;
  committing?: boolean;
}

function RiskChip({ risk }: { risk: Change["risk"] }) {
  const tone =
    risk === "high" ? "bg-lost-soft text-lost" : risk === "medium" ? "bg-warn-soft text-warn" : "bg-panel-2 text-muted";
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] ${tone}`}>{risk}</span>
  );
}

function ChangeRow({
  change,
  editable,
  onApprove,
  onReject,
}: {
  change: Change;
  editable: boolean;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
  const Icon = OP_ICON[change.op];
  return (
    <div
      className={`flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0 ${
        change.approval === "rejected" ? "opacity-50" : ""
      }`}
    >
      <Icon size={14} className="mt-0.5 flex-none text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">{OP_LABEL[change.op]}</span>
          <span className="text-[12px] font-medium text-muted">{change.dealName}</span>
          <RiskChip risk={change.risk} />
        </div>
        {change.op === "update_field" && change.before !== undefined ? (
          <p className="mt-0.5 text-[13px]">
            {change.summary}:{" "}
            <span className="rounded bg-lost-soft px-1 font-mono text-[12px] text-lost line-through">{change.before}</span>
            {" → "}
            <span className="rounded bg-won-soft px-1 font-mono text-[12px] text-won">{change.after}</span>
          </p>
        ) : (
          <p className="mt-0.5 text-[13px]">{change.summary}</p>
        )}
      </div>
      {editable ? (
        <div className="flex flex-none gap-1">
          <button
            aria-label="Approve change"
            onClick={() => change.approval !== "approved" && onApprove?.(change.id)}
            className={`rounded-md p-1.5 ${
              change.approval === "approved" ? "bg-won text-white" : "border border-line text-faint hover:border-won hover:text-won"
            }`}
          >
            <Check size={13} strokeWidth={2.5} />
          </button>
          <button
            aria-label="Reject change"
            onClick={() => change.approval !== "rejected" && onReject?.(change.id)}
            className={`rounded-md p-1.5 ${
              change.approval === "rejected" ? "bg-lost text-white" : "border border-line text-faint hover:border-lost hover:text-lost"
            }`}
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
      ) : (
        <span
          className={`flex-none font-mono text-[10px] uppercase tracking-[0.08em] ${
            change.approval === "approved" ? "text-won" : change.approval === "rejected" ? "text-lost" : "text-faint"
          }`}
        >
          {change.approval}
        </span>
      )}
    </div>
  );
}

export function DiffViewer({
  changeSet,
  compact = false,
  handlers,
}: {
  changeSet: ChangeSet;
  compact?: boolean;
  /** Omit for a read-only view (e.g. committed history). */
  handlers?: DiffViewerHandlers;
}) {
  const reviewable = changeSet.status === "in_review" || changeSet.status === "approved";
  const editable = reviewable && !!handlers;
  const committing = handlers?.committing ?? false;
  const approved = changeSet.changes.filter((c) => c.approval === "approved").length;
  const rejected = changeSet.changes.filter((c) => c.approval === "rejected").length;
  const pending = changeSet.changes.length - approved - rejected;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-card">
      <div className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-[14px] font-semibold">{changeSet.title}</h3>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
            {changeSet.origin === "ai_run" ? "ai run" : "manual"}
          </span>
          {changeSet.status === "committed" && (
            <span className="rounded-full bg-won-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-won">
              committed
            </span>
          )}
          {changeSet.status === "rejected" && (
            <span className="rounded-full bg-lost-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-lost">
              rejected
            </span>
          )}
        </div>
        {!compact && (
          <p className="mt-1 text-[12px] text-muted">
            “{changeSet.intent}” · {changeSet.authorName} · {changeSet.changes.length} changes
          </p>
        )}
      </div>

      {editable && handlers && (
        <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2">
          <span className="font-mono text-[10.5px] text-faint">
            zero mutations until commit — everything below is staged
          </span>
          <button
            onClick={handlers.onApproveAll}
            className="ml-auto rounded-md border border-line px-2 py-1 font-mono text-[10.5px] text-muted hover:border-won hover:text-won"
          >
            approve all
          </button>
          <button
            onClick={handlers.onRejectAll}
            className="rounded-md border border-line px-2 py-1 font-mono text-[10.5px] text-muted hover:border-lost hover:text-lost"
          >
            reject all
          </button>
        </div>
      )}

      <div>
        {changeSet.changes.map((c) => (
          <ChangeRow
            key={c.id}
            change={c}
            editable={editable}
            onApprove={handlers?.onApprove}
            onReject={handlers?.onReject}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 border-t border-line px-4 py-3">
        <span className="font-mono text-[11px] text-faint">
          <span className="text-won">{approved} approved</span> · <span className="text-lost">{rejected} rejected</span> ·{" "}
          {pending} pending
        </span>
        {editable && handlers && (
          <button
            onClick={handlers.onCommit}
            disabled={approved === 0 || committing}
            className="ml-auto rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-accent-ink disabled:opacity-40"
          >
            {committing ? "Committing…" : `Commit ${approved > 0 ? `${approved} approved` : ""}`}
          </button>
        )}
      </div>
    </div>
  );
}
