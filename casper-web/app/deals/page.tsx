"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useStore } from "@/lib/store";
import { neglectReasons } from "@/lib/pipeline";
import { dateShort, money, relDays } from "@/lib/format";
import type { Company, Deal, User } from "@/lib/types";
import { loadPipeline } from "@/lib/server/actions";
import { PageHeader } from "@/components/page-header";
import { TableSkeletonRows } from "@/components/skeleton";
import { NeglectBadge, StageBadge } from "@/components/stage-badge";

type View = "all" | "mine" | "neglected" | "closing";

const VIEWS: { key: View; label: string }[] = [
  { key: "all", label: "All open deals" },
  { key: "mine", label: "My open deals" },
  { key: "neglected", label: "Neglected" },
  { key: "closing", label: "Closing this month" },
];

export default function DealsPage() {
  const router = useRouter();
  const startRun = useStore((s) => s.startRun); // opens the dock + launches a real casper-ai run
  const [deals, setDeals] = useState<Deal[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("all");

  useEffect(() => {
    void (async () => {
      const data = await loadPipeline();
      setDeals(data.deals);
      setCompanies(data.companies);
      setUsers(data.users);
      setLoading(false);
    })();
  }, []);

  // Single dev principal until login lands, so "mine" resolves to that user.
  const currentUserId = users[0]?.id;
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? "—";
  const owner = (id: string) => users.find((u) => u.id === id);

  const rows = useMemo(() => {
    let list = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
    if (view === "mine") list = list.filter((d) => d.ownerId === currentUserId);
    if (view === "neglected") list = list.filter((d) => neglectReasons(d).length > 0);
    if (view === "closing") list = list.filter((d) => d.expectedCloseDate?.startsWith("2026-07"));
    return list.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  }, [deals, view, currentUserId]);

  const neglectedMine = deals.filter((d) => d.ownerId === currentUserId && neglectReasons(d).length > 0).length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader kicker="casper-records · deal" title="Deals">
        {view === "neglected" && neglectedMine > 0 && (
          <button
            onClick={startRun}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink"
          >
            <Sparkles size={14} />
            Prepare follow-ups ({neglectedMine})
          </button>
        )}
      </PageHeader>

      <div className="flex flex-wrap gap-1.5 px-6 pb-3">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`rounded-full px-3 py-1 text-[12.5px] ${
              view === v.key ? "bg-ink text-panel" : "border border-line text-muted hover:border-line-strong"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-card">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-panel-2/50 text-left">
                {["Deal", "Company", "Stage", "Amount", "Close", "Owner", "Last activity"].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className={`px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-faint ${
                      h === "Amount" ? "text-right" : ""
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeletonRows rows={4} cols={7} />}
              {rows.map((d: Deal) => {
                const reasons = neglectReasons(d);
                return (
                  <tr
                    key={d.id}
                    onClick={() => router.push(`/deals/${d.id}`)}
                    className="cursor-pointer border-b border-line last:border-b-0 hover:bg-panel-2/40"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{d.name}</span>
                        {reasons.length > 0 && <NeglectBadge reasons={reasons} />}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted">{companyName(d.companyId)}</td>
                    <td className="px-4 py-2.5">
                      <StageBadge stage={d.stage} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{money(d.amount, d.currency)}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-muted">{dateShort(d.expectedCloseDate)}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-muted">{owner(d.ownerId)?.name}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-muted">{relDays(d.lastActivityAt)}</td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center font-mono text-[12px] text-faint">
                    No deals match this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
