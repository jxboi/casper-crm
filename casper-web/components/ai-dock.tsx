"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Check, Circle, Loader2, Sparkles, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { DiffViewer } from "@/components/diff-viewer";

const TABS = ["conversation", "plan", "workspace", "changes"] as const;

export function AIDock() {
  const toggleDock = useStore((s) => s.toggleDock);
  const tab = useStore((s) => s.dockTab);
  const setTab = useStore((s) => s.setDockTab);
  const run = useStore((s) => s.run);
  const drafts = useStore((s) => s.drafts);
  const changeSet = useStore((s) => s.run.changeSet);
  const startRun = useStore((s) => s.startRun);
  const answerClarify = useStore((s) => s.answerClarify);
  const reviewRunChange = useStore((s) => s.reviewRunChange);
  const reviewAllRun = useStore((s) => s.reviewAllRun);
  const commitRunChangeSet = useStore((s) => s.commitRunChangeSet);
  const committing = useStore((s) => s.committing !== null);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [run.messages.length, tab]);

  const pendingChanges = changeSet?.changes.filter((c) => c.approval === "pending").length ?? 0;
  const badge: Record<(typeof TABS)[number], number> = {
    conversation: 0,
    plan: run.steps.filter((s) => s.status !== "done").length,
    workspace: drafts.length,
    changes: pendingChanges,
  };

  return (
    <aside className="flex w-[380px] flex-none flex-col border-l border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Sparkles size={15} className="text-accent" />
        <span className="font-display text-[14px] font-semibold">Sales Assistant</span>
        <span className="rounded-full bg-panel-2 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">
          governed principal
        </span>
        <button onClick={() => toggleDock(false)} aria-label="Close assistant" className="ml-auto text-faint hover:text-ink">
          <X size={16} />
        </button>
      </div>

      <div className="flex border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative flex-1 px-1 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] ${
              tab === t ? "text-accent" : "text-faint hover:text-muted"
            }`}
          >
            {t}
            {badge[t] > 0 && <span className="ml-1 rounded-full bg-accent-soft px-1 text-[9px] text-accent">{badge[t]}</span>}
            {tab === t && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded bg-accent" />}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "conversation" && (
          <div className="flex flex-col gap-3">
            {run.messages.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="max-w-[26ch] text-[13px] text-muted">
                  Your assistant prepares work; you review and commit. It cannot write anything without approval.
                </p>
                <button
                  onClick={startRun}
                  className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink"
                >
                  Prepare follow-ups for my neglected deals
                </button>
              </div>
            )}
            {run.messages.map((m) => (
              <div
                key={m.id}
                className={`rise max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                  m.role === "user" ? "self-end bg-accent text-accent-ink" : "self-start border border-line bg-panel-2/60"
                }`}
              >
                {m.text}
                {m.chips && run.status === "clarifying" && (
                  <span className="mt-2.5 flex flex-wrap gap-1.5">
                    {m.chips.map((chip) => (
                      <button
                        key={chip}
                        onClick={() => answerClarify(chip)}
                        className="rounded-full border border-accent px-2.5 py-1 text-[12px] text-accent hover:bg-accent-soft"
                      >
                        {chip}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            ))}
            {(run.status === "review" || run.status === "committed") && (
              <button
                onClick={() => setTab("changes")}
                className="self-start rounded-md border border-accent px-2.5 py-1 text-[12px] text-accent hover:bg-accent-soft"
              >
                Review changes →
              </button>
            )}
            {run.status === "committed" && (
              <button onClick={startRun} className="self-start text-[12px] text-faint underline hover:text-muted">
                Run the demo again
              </button>
            )}
          </div>
        )}

        {tab === "plan" && (
          <div className="flex flex-col gap-1">
            {run.steps.length === 0 && <p className="py-10 text-center text-[12.5px] text-faint">No active plan.</p>}
            {run.steps.map((s) => (
              <div key={s.id} className="rise flex items-start gap-2.5 rounded-md px-2 py-2">
                {s.status === "done" ? (
                  <Check size={14} className="mt-0.5 flex-none text-won" strokeWidth={2.5} />
                ) : s.status === "active" ? (
                  <Loader2 size={14} className="mt-0.5 flex-none animate-spin text-accent" />
                ) : (
                  <Circle size={13} className="mt-0.5 flex-none text-line-strong" />
                )}
                <div>
                  <p className={`text-[13px] font-medium ${s.status === "pending" ? "text-faint" : ""}`}>{s.label}</p>
                  <p className="font-mono text-[10.5px] text-faint">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "workspace" && (
          <div className="flex flex-col gap-3">
            {drafts.length === 0 && (
              <p className="py-10 text-center text-[12.5px] text-faint">No artifacts yet — drafts land here.</p>
            )}
            {drafts.map((d) => (
              <div key={d.id} className="rise overflow-hidden rounded-lg border border-line">
                <div className="border-b border-line bg-panel-2/60 px-3 py-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">email draft · artifact</p>
                  <p className="mt-0.5 text-[12.5px] font-medium">{d.subject}</p>
                  <p className="font-mono text-[11px] text-muted">to {d.to}</p>
                </div>
                <p className="whitespace-pre-wrap px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">{d.body}</p>
              </div>
            ))}
          </div>
        )}

        {tab === "changes" && (
          <div className="flex flex-col gap-3">
            {!changeSet && (
              <p className="py-10 text-center text-[12.5px] text-faint">
                No change set yet. Ask the assistant to prepare follow-ups.
              </p>
            )}
            {changeSet && (
              <>
                <DiffViewer
                  changeSet={changeSet}
                  compact
                  handlers={{
                    onApprove: (id) => void reviewRunChange(id, "approved"),
                    onReject: (id) => void reviewRunChange(id, "rejected"),
                    onApproveAll: () => void reviewAllRun("approved"),
                    onRejectAll: () => void reviewAllRun("rejected"),
                    onCommit: () => void commitRunChangeSet(),
                    committing,
                  }}
                />
                <Link href="/approvals" className="text-[12px] text-faint underline hover:text-muted">
                  Open in the Approvals inbox
                </Link>
              </>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-line px-4 py-2.5">
        <p className="font-mono text-[9.5px] leading-relaxed text-faint">
          live run — the real casper-ai engine drives the model + tools and streams over SSE (D-019) · zero
          unapproved mutations, by construction (D-006)
        </p>
      </div>
    </aside>
  );
}
