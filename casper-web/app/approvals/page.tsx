"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Inbox, Sparkles } from "lucide-react";
import { useStore } from "@/lib/store";
import type { ChangeSet } from "@/lib/types";
import {
  approveAllAction,
  approveChangeAction,
  commitChangeSetAction,
  listWebChangeSets,
  rejectAllAction,
  rejectChangeAction,
} from "@/lib/server/changesets";
import { PageHeader } from "@/components/page-header";
import { DiffViewer } from "@/components/diff-viewer";
import { Skeleton } from "@/components/skeleton";

/**
 * The Approvals inbox — every change set staged in the workspace, reviewable in one
 * place, on the **real** casper-changesets engine (D-006). Same DiffViewer as the dock's
 * Changes tab, but this surface owns its own list state and drives the engine directly,
 * so approving here and there both hit the same source of truth.
 */
export default function ApprovalsPage() {
  const startRun = useStore((s) => s.startRun);
  const toast = useStore((s) => s.toast);
  const refreshApprovalsCount = useStore((s) => s.refreshApprovalsCount);
  // Re-fetch when the nav badge changes (a dock run staged or committed a set).
  const pendingApprovals = useStore((s) => s.pendingApprovals);

  const [sets, setSets] = useState<ChangeSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [committingId, setCommittingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await listWebChangeSets();
    setSets(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, pendingApprovals]);

  const replace = (updated: ChangeSet) =>
    setSets((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

  // Reviewable (in-review / approved) first, committed + rejected history below. The
  // engine already returns newest-first, and Array.sort is stable, so this just lifts
  // the still-open sets to the top without disturbing recency within each group.
  const sorted = useMemo(() => {
    const rank = (c: ChangeSet) => (c.status === "in_review" || c.status === "approved" ? 0 : 1);
    return [...sets].sort((a, b) => rank(a) - rank(b));
  }, [sets]);
  const inReview = sets.filter((c) => c.status === "in_review" || c.status === "approved").length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader kicker="casper-changesets · draft → review → commit" title="Approvals">
        <p className="max-w-[42ch] text-right text-[12px] text-muted">
          {inReview > 0
            ? `${inReview} change set${inReview === 1 ? "" : "s"} waiting for review. Nothing touches a record until you commit.`
            : "Drafts from assistant runs land here for review before anything is written."}
        </p>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {loading ? (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="overflow-hidden rounded-lg border border-line bg-panel">
                <div className="border-b border-line px-4 py-3">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="mt-1.5 h-3 w-72" />
                </div>
                {Array.from({ length: 3 }, (_, r) => (
                  <div key={r} className="border-b border-line px-4 py-3 last:border-b-0">
                    <Skeleton className="h-3.5 w-2/3" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-16 text-center">
            <Inbox size={22} className="text-faint" />
            <p className="text-[13px] text-muted">Nothing waiting for review.</p>
            <p className="max-w-[40ch] text-[12px] text-faint">
              Ask the assistant to prepare work — it stages a change set here, and nothing is written until you approve
              and commit.
            </p>
            <button
              onClick={startRun}
              className="mt-2 flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink"
            >
              <Sparkles size={14} />
              Prepare follow-ups for my neglected deals
            </button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {sorted.map((cs) => (
              <div key={cs.id} className="rise">
                <DiffViewer
                  changeSet={cs}
                  handlers={{
                    onApprove: (id) => void approveChangeAction(cs.id, id).then(replace),
                    onReject: (id) => void rejectChangeAction(cs.id, id).then(replace),
                    onApproveAll: () => void approveAllAction(cs.id).then(replace),
                    onRejectAll: () => void rejectAllAction(cs.id).then(replace),
                    committing: committingId === cs.id,
                    onCommit: async () => {
                      setCommittingId(cs.id);
                      try {
                        const result = await commitChangeSetAction(cs.id);
                        replace(result.changeSet);
                        if (result.ok) {
                          const applied = result.changeSet.changes.filter((c) => c.approval === "approved").length;
                          toast("ok", `Committed ${applied} change${applied === 1 ? "" : "s"} through the engine — fully audited`);
                        } else {
                          toast("warn", result.issues[0] ?? "Some changes couldn't be committed — re-review needed");
                        }
                      } catch {
                        toast("err", "Commit failed — nothing was written. Try again.");
                      } finally {
                        setCommittingId(null);
                        void refreshApprovalsCount();
                      }
                    },
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
