"use client";

import { useEffect, useState } from "react";
import type { Company, Contact } from "@/lib/types";
import { loadDirectory } from "@/lib/server/actions";
import { PageHeader } from "@/components/page-header";
import { TableSkeletonRows } from "@/components/skeleton";

const HEADERS = ["Contact", "Title", "Email", "Company"];

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const data = await loadDirectory();
      setContacts(data.contacts.sort((a, b) => a.name.localeCompare(b.name)));
      setCompanies(data.companies);
      setLoading(false);
    })();
  }, []);

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex h-full flex-col">
      <PageHeader kicker="casper-records · contact" title="Contacts" />

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
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-b-0 hover:bg-panel-2/40">
                  <td className="px-4 py-2.5 font-medium">{c.name}</td>
                  <td className="px-4 py-2.5 text-muted">{c.title || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-muted">{c.email || "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{c.companyId ? companyName(c.companyId) : "—"}</td>
                </tr>
              ))}
              {!loading && contacts.length === 0 && (
                <tr>
                  <td colSpan={HEADERS.length} className="px-4 py-10 text-center font-mono text-[12px] text-faint">
                    No contacts yet.
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
