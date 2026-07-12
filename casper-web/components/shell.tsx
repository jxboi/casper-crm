"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Columns3, Inbox, MessageSquarePlus, Sparkles, Table2, Users } from "lucide-react";
import { useCurrentUser, useStore } from "@/lib/store";
import { PIPELINE } from "@/lib/pipeline";
import { AIDock } from "@/components/ai-dock";
import { FeedbackWidget } from "@/components/feedback-widget";
import { Toaster } from "@/components/toaster";

const NAV = [
  { href: "/pipeline", label: "Pipeline", icon: Columns3 },
  { href: "/deals", label: "Deals", icon: Table2 },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/approvals", label: "Approvals", icon: Inbox },
  { href: "/feedback", label: "Feedback", icon: MessageSquarePlus },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useCurrentUser();
  const setUser = useStore((s) => s.setUser);
  const users = useStore((s) => s.users);
  const dockOpen = useStore((s) => s.dockOpen);
  const toggleDock = useStore((s) => s.toggleDock);
  const pendingApprovals = useStore((s) => s.changeSets.filter((c) => c.status === "in_review").length);
  const newFeedback = useStore(
    (s) => s.feedback.filter((f) => f.status === "new" && !f.mergedInto).length
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-52 flex-none flex-col border-r border-line bg-panel">
        <div className="flex items-baseline gap-2 px-4 pb-4 pt-5">
          <span className="font-display text-[17px] font-semibold tracking-tight">Casper</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">sales · dogfood</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] ${
                  active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-panel-2 hover:text-ink"
                }`}
              >
                <Icon size={15} strokeWidth={2} />
                {label}
                {href === "/approvals" && pendingApprovals > 0 && (
                  <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-accent-ink">
                    {pendingApprovals}
                  </span>
                )}
                {href === "/feedback" && newFeedback > 0 && (
                  <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-accent-ink">
                    {newFeedback}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-1.5 border-t border-line px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
            pipeline v{PIPELINE.version} · active
          </span>
          <span className="font-mono text-[10px] text-faint">demo mode — in-memory data</span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-13 flex-none items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
          <div className="min-w-0 flex-1" />
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">acting as</span>
            <select
              value={user.id}
              onChange={(e) => setUser(e.target.value)}
              className="rounded-md border border-line bg-panel px-2 py-1.5 text-[12.5px] text-ink"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.role}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => toggleDock()}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              dockOpen ? "bg-accent text-accent-ink" : "border border-line text-muted hover:border-accent hover:text-accent"
            }`}
          >
            <Sparkles size={14} />
            Assistant
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>

      {dockOpen && <AIDock />}
      <FeedbackWidget />
      <Toaster />
    </div>
  );
}
