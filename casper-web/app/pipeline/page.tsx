"use client";

import { useState } from "react";
import Link from "next/link";
import { GripVertical } from "lucide-react";
import { useStore } from "@/lib/store";
import { PIPELINE, legalTargets, neglectReasons, stageOf } from "@/lib/pipeline";
import { money } from "@/lib/format";
import type { Deal, StageKey } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { NeglectBadge } from "@/components/stage-badge";
import { LostReasonDialog } from "@/components/lost-reason-dialog";

const COLUMNS = PIPELINE.stages;

function DealCard({ deal, onDragStart }: { deal: Deal; onDragStart: (id: string) => void }) {
  const company = useStore((s) => s.companies.find((c) => c.id === deal.companyId));
  const owner = useStore((s) => s.users.find((u) => u.id === deal.ownerId));
  const reasons = neglectReasons(deal);
  return (
    <Link
      href={`/deals/${deal.id}`}
      draggable
      onDragStart={() => onDragStart(deal.id)}
      className="group block rounded-lg border border-line bg-panel p-3 shadow-card transition-shadow hover:border-line-strong"
    >
      <div className="flex items-start gap-1.5">
        <GripVertical size={13} className="mt-0.5 flex-none text-line-strong opacity-0 group-hover:opacity-100" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium">{deal.name}</p>
          <p className="truncate text-[12px] text-muted">{company?.name}</p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="font-mono text-[12.5px] font-medium tabular-nums">{money(deal.amount, deal.currency)}</span>
        <span
          className="flex size-5 items-center justify-center rounded-full bg-panel-2 font-mono text-[9.5px] font-semibold text-muted"
          title={owner?.name}
        >
          {owner?.initials}
        </span>
      </div>
      {reasons.length > 0 && (
        <div className="mt-2">
          <NeglectBadge reasons={reasons} />
        </div>
      )}
    </Link>
  );
}

export default function PipelinePage() {
  const deals = useStore((s) => s.deals);
  const transition = useStore((s) => s.transition);
  const toast = useStore((s) => s.toast);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<StageKey | null>(null);
  const [lostFor, setLostFor] = useState<Deal | null>(null);

  const drop = (to: StageKey) => {
    setOverStage(null);
    const deal = deals.find((d) => d.id === dragId);
    setDragId(null);
    if (!deal || deal.stage === to) return;

    if (to === "lost") {
      setLostFor(deal);
      return;
    }
    const legal = legalTargets(deal).some((t) => t.to === to);
    if (!legal) {
      toast("warn", `No transition ${stageOf(deal.stage).name} → ${stageOf(to).name} in v${PIPELINE.version}`);
      return;
    }
    const result = transition(deal.id, to);
    if (result.ok) {
      toast("ok", `${deal.name}: ${stageOf(deal.stage).name} → ${stageOf(to).name}`);
    } else {
      result.issues.forEach((i) => toast("err", i));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader kicker="casper-workflow · deal-pipeline v4" title="Pipeline">
        <p className="max-w-[42ch] text-right text-[12px] text-muted">
          Drag a card to transition. Guards run on drop — a rejected move rolls back and tells you why.
        </p>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-x-auto px-6 pb-6">
        <div className="flex h-full min-w-max gap-3">
          {COLUMNS.map((col) => {
            const colDeals = deals.filter((d) => d.stage === col.key);
            const total = colDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
            const isOver = overStage === col.key;
            return (
              <div
                key={col.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStage(col.key);
                }}
                onDragLeave={() => setOverStage((s) => (s === col.key ? null : s))}
                onDrop={() => drop(col.key)}
                className={`flex w-64 flex-none flex-col rounded-xl border ${
                  isOver ? "border-accent bg-accent-soft/40" : "border-line bg-panel-2/40"
                }`}
              >
                <div className="flex items-center justify-between px-3 pb-2 pt-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`size-2 rounded-full ${
                        col.category === "won" ? "bg-won" : col.category === "lost" ? "bg-lost" : "bg-accent"
                      }`}
                    />
                    <span className="text-[13px] font-semibold">{col.name}</span>
                    <span className="font-mono text-[11px] text-faint">{colDeals.length}</span>
                  </div>
                  <span className="font-mono text-[11px] tabular-nums text-muted">
                    {total > 0 ? money(total, "SGD") : ""}
                  </span>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {colDeals.map((d) => (
                    <DealCard key={d.id} deal={d} onDragStart={setDragId} />
                  ))}
                  {colDeals.length === 0 && (
                    <p className="px-1 py-4 text-center font-mono text-[10.5px] text-faint">empty</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {lostFor && <LostReasonDialog dealId={lostFor.id} dealName={lostFor.name} onClose={() => setLostFor(null)} />}
    </div>
  );
}
