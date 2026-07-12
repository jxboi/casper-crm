"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { legalTargets, neglectReasons, stageOf } from "@/lib/pipeline";
import { dueLabel, money, relDays } from "@/lib/format";
import type { Deal } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { NeglectBadge, StageBadge } from "@/components/stage-badge";
import { Timeline } from "@/components/timeline";
import { LostReasonDialog } from "@/components/lost-reason-dialog";

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel shadow-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Read-only key/value row. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">{label}</span>
      <span className="text-right text-[13px]">{children}</span>
    </div>
  );
}

/** Inline-editable field wired to updateDealField — edits emit record.updated. */
function EditableField({
  label,
  dealId,
  fieldKey,
  value,
  type,
}: {
  label: string;
  dealId: string;
  fieldKey: "nextActionDate" | "expectedCloseDate" | "source";
  value: string | null;
  type: "date" | "text";
}) {
  const updateDealField = useStore((s) => s.updateDealField);
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">{label}</span>
      <input
        type={type}
        defaultValue={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v && v !== value) updateDealField(dealId, fieldKey, v);
        }}
        placeholder={type === "text" ? "—" : undefined}
        className="w-40 rounded-md border border-line bg-panel-2/40 px-2 py-1 text-right text-[12.5px] outline-none focus:border-accent"
      />
    </div>
  );
}

function StageControls({ deal }: { deal: Deal }) {
  const transition = useStore((s) => s.transition);
  const toast = useStore((s) => s.toast);
  const [lostOpen, setLostOpen] = useState(false);
  const targets = legalTargets(deal);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {targets.length === 0 && <span className="text-[12.5px] text-faint">No transitions from {stageOf(deal.stage).name}.</span>}
        {targets.map(({ to, transition: t }) => {
          const target = stageOf(to);
          const isLost = to === "lost";
          const tone = isLost
            ? "border-lost/40 text-lost hover:bg-lost-soft"
            : to === "won"
              ? "border-won/40 text-won hover:bg-won-soft"
              : "border-line text-muted hover:border-accent hover:text-accent";
          return (
            <button
              key={to}
              onClick={() => {
                if (isLost) {
                  setLostOpen(true);
                  return;
                }
                const result = transition(deal.id, to);
                if (result.ok) toast("ok", `${deal.name}: ${stageOf(deal.stage).name} → ${target.name}`);
                else result.issues.forEach((i) => toast("err", i));
              }}
              className={`rounded-md border px-3 py-1.5 text-[12.5px] font-medium ${tone}`}
            >
              {t.label ? t.label : `→ ${target.name}`}
            </button>
          );
        })}
      </div>
      {lostOpen && <LostReasonDialog dealId={deal.id} dealName={deal.name} onClose={() => setLostOpen(false)} />}
    </>
  );
}

function TasksCard({ dealId }: { dealId: string }) {
  const allTasks = useStore((s) => s.tasks);
  const tasks = useMemo(() => allTasks.filter((t) => t.dealId === dealId), [allTasks, dealId]);
  const toggleTask = useStore((s) => s.toggleTask);
  const addTask = useStore((s) => s.addTask);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  const submit = () => {
    if (!title.trim() || !due) return;
    addTask(dealId, title.trim(), due);
    setTitle("");
    setDue("");
  };

  return (
    <Card title="Tasks">
      <ul className="flex flex-col gap-1">
        {tasks.length === 0 && <li className="py-2 text-center font-mono text-[11px] text-faint">no open tasks</li>}
        {tasks.map((t) => {
          const d = dueLabel(t.dueDate);
          return (
            <li key={t.id} className="flex items-center gap-2.5 py-1">
              <button
                onClick={() => toggleTask(t.id)}
                aria-label={t.done ? "Mark not done" : "Mark done"}
                className={`flex size-4 flex-none items-center justify-center rounded border ${
                  t.done ? "border-won bg-won text-white" : "border-line-strong hover:border-accent"
                }`}
              >
                {t.done && <Check size={11} strokeWidth={3} />}
              </button>
              <span className={`flex-1 text-[13px] ${t.done ? "text-faint line-through" : ""}`}>{t.title}</span>
              {t.origin !== "manual" && (
                <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-accent">
                  {t.origin}
                </span>
              )}
              <span className={`font-mono text-[10.5px] ${d.overdue && !t.done ? "text-lost" : "text-faint"}`}>{d.text}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Add a task…"
          className="min-w-0 flex-1 rounded-md border border-line bg-panel-2/40 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="rounded-md border border-line bg-panel-2/40 px-2 py-1.5 text-[12px] outline-none focus:border-accent"
        />
        <button
          onClick={submit}
          disabled={!title.trim() || !due}
          className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink disabled:opacity-40"
        >
          <Plus size={13} />
          Add
        </button>
      </div>
    </Card>
  );
}

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const deal = useStore((s) => s.deals.find((d) => d.id === id));
  const company = useStore((s) => s.companies.find((c) => c.id === deal?.companyId));
  const owner = useStore((s) => s.users.find((u) => u.id === deal?.ownerId));
  const contacts = useStore((s) => s.contacts);
  const allTimeline = useStore((s) => s.timeline);
  const timeline = useMemo(() => allTimeline.filter((e) => e.dealId === id), [allTimeline, id]);

  const dealContacts = useMemo(
    () => (deal ? contacts.filter((c) => deal.contactIds.includes(c.id)) : []),
    [contacts, deal]
  );

  if (!deal) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-[14px] text-muted">Deal not found.</p>
        <Link href="/deals" className="text-[13px] text-accent underline">
          Back to deals
        </Link>
      </div>
    );
  }

  const reasons = neglectReasons(deal);

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-5">
        <Link href="/deals" className="inline-flex items-center gap-1.5 font-mono text-[11px] text-faint hover:text-muted">
          <ArrowLeft size={13} /> Deals
        </Link>
      </div>
      <PageHeader kicker={`casper-records · deal:${deal.id}`} title={deal.name}>
        <div className="flex items-center gap-2">
          <StageBadge stage={deal.stage} />
          {reasons.length > 0 && <NeglectBadge reasons={reasons} />}
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-4">
            <Card title="Details">
              <Field label="Company">
                <span>{company?.name}</span>
              </Field>
              <Field label="Amount">
                <span className="font-mono tabular-nums">{money(deal.amount, deal.currency)}</span>
              </Field>
              <EditableField label="Expected close" dealId={deal.id} fieldKey="expectedCloseDate" value={deal.expectedCloseDate} type="date" />
              <EditableField label="Next action" dealId={deal.id} fieldKey="nextActionDate" value={deal.nextActionDate} type="date" />
              <EditableField label="Source" dealId={deal.id} fieldKey="source" value={deal.source} type="text" />
              <Field label="Owner">
                <span>{owner?.name}</span>
              </Field>
              <Field label="Contacts">
                <span>{dealContacts.map((c) => c.name).join(", ") || "—"}</span>
              </Field>
              <Field label="Workflow">
                <span className="font-mono text-[11.5px] text-muted">deal-pipeline v{deal.workflowVersion}</span>
              </Field>
              {deal.lostReason && (
                <Field label="Lost reason">
                  <span className="text-lost">{deal.lostReason}</span>
                </Field>
              )}
            </Card>

            <Card title={`Stage · ${stageOf(deal.stage).name}`}>
              <StageControls deal={deal} />
              <p className="mt-3 font-mono text-[10.5px] text-faint">
                Guards run on transition — a rejected move rolls back and tells you why (casper-workflow).
              </p>
            </Card>

            <TasksCard dealId={deal.id} />
          </div>

          <Card title={`Timeline · ${timeline.length} events`}>
            {timeline.length === 0 ? (
              <p className="py-6 text-center font-mono text-[11px] text-faint">no events yet</p>
            ) : (
              <Timeline events={timeline} />
            )}
            <p className="mt-2 font-mono text-[10px] text-faint">last touch {relDays(deal.lastActivityAt)}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
