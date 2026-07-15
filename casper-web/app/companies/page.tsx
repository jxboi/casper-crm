"use client";

import { useEffect, useState } from "react";
import type { Company } from "@/lib/types";
import { loadDirectory } from "@/lib/server/actions";
import { PageHeader } from "@/components/page-header";
import { TableSkeletonRows } from "@/components/skeleton";

const HEADERS = ["Company", "Domain", "Industry", "Size", "Region"];

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const data = await loadDirectory();
      setCompanies(data.companies.sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
    })();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader kicker="casper-records · company" title="Companies" />

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-card">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-panel-2/50 text-left">
                {HEADERS.map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-faint">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeletonRows rows={5} cols={HEADERS.length} />}
              {companies.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-b-0 hover:bg-panel-2/40">
                  <td className="px-4 py-2.5 font-medium">{c.name}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-muted">{c.domain || "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{c.industry || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-muted">{c.size || "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{c.region || "—"}</td>
                </tr>
              ))}
              {!loading && companies.length === 0 && (
                <tr>
                  <td colSpan={HEADERS.length} className="px-4 py-10 text-center font-mono text-[12px] text-faint">
                    No companies yet.
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
