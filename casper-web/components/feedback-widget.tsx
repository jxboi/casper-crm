"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, MapPin, MessageSquarePlus, Paperclip, Send, User, Workflow, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { captureFor, dealIdFromRoute, targetOptions } from "@/lib/feedback";
import type { FeedbackScreenshot } from "@/lib/types";

export function FeedbackWidget() {
  const pathname = usePathname();
  const deals = useStore((s) => s.deals);
  const submitFeedback = useStore((s) => s.submitFeedback);
  const dockOpen = useStore((s) => s.dockOpen);

  const [open, setOpen] = useState(false);
  const [targetIdx, setTargetIdx] = useState(0);
  const [body, setBody] = useState("");
  const [action, setAction] = useState("");
  const [screenshot, setScreenshot] = useState<FeedbackScreenshot | null>(null);
  const [showContext, setShowContext] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const targets = useMemo(() => targetOptions(pathname), [pathname]);
  const capture = useMemo(() => {
    const dealId = dealIdFromRoute(pathname);
    return captureFor(pathname, dealId ? deals.find((d) => d.id === dealId) : undefined);
  }, [pathname, deals]);

  // Route changed under the panel — reset the target to the new screen's default.
  useEffect(() => setTargetIdx(0), [pathname]);
  useEffect(() => {
    if (open) bodyRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const reset = () => {
    setBody("");
    setAction("");
    setScreenshot(null);
    setShowContext(false);
    setTargetIdx(0);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setScreenshot({ name: file.name, dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const submit = () => {
    if (!body.trim()) return;
    submitFeedback({
      target: targets[targetIdx] ?? targets[0],
      body,
      action,
      screenshot,
      capture,
    });
    reset();
    setOpen(false);
  };

  return (
    <div className={`fixed bottom-4 z-40 flex flex-col items-end gap-3 ${dockOpen ? "right-[396px]" : "right-4"}`}>
      {open && (
        <div className="rise flex w-[360px] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-card">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <MessageSquarePlus size={15} className="text-accent" />
            <span className="font-display text-[14px] font-semibold">Send feedback</span>
            <span className="rounded-full bg-panel-2 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">
              {capture.screen}
            </span>
            <button onClick={() => setOpen(false)} aria-label="Close feedback" className="ml-auto text-faint hover:text-ink">
              <X size={16} />
            </button>
          </div>

          <div className="flex flex-col gap-3 p-4">
            <div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">What's this about?</p>
              <div className="flex flex-wrap gap-1.5">
                {targets.map((t, i) => (
                  <button
                    key={t.label}
                    onClick={() => setTargetIdx(i)}
                    className={`rounded-full px-2.5 py-1 text-[12px] ${
                      i === targetIdx
                        ? "bg-ink text-panel"
                        : "border border-line text-muted hover:border-line-strong"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              rows={4}
              placeholder="What's working, what's not, what you wish it did…"
              className="w-full resize-none rounded-lg border border-line bg-panel-2/40 px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-accent"
            />

            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="Optional: what were you trying to do?"
              className="w-full rounded-lg border border-line bg-panel-2/40 px-3 py-1.5 text-[12.5px] outline-none focus:border-accent"
            />

            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              {screenshot ? (
                <span className="flex items-center gap-1.5 rounded-md border border-line bg-panel-2/40 px-2 py-1 text-[11.5px] text-muted">
                  <Paperclip size={12} />
                  <span className="max-w-[160px] truncate">{screenshot.name}</span>
                  <button onClick={() => setScreenshot(null)} aria-label="Remove screenshot" className="text-faint hover:text-ink">
                    <X size={12} />
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11.5px] text-muted hover:border-line-strong"
                >
                  <Paperclip size={12} />
                  Attach screenshot
                </button>
              )}
            </div>

            {/* Auto-captured context — shown so the user sees exactly what's attached. */}
            <div className="rounded-lg border border-line bg-panel-2/30">
              <button
                onClick={() => setShowContext((v) => !v)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-faint"
              >
                <ChevronDown size={12} className={`transition-transform ${showContext ? "" : "-rotate-90"}`} />
                Attached automatically
              </button>
              {showContext && (
                <div className="flex flex-col gap-1.5 px-3 pb-3 text-[11.5px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <MapPin size={12} className="flex-none text-faint" />
                    {capture.screen}
                    <span className="font-mono text-[10px] text-faint">{capture.route}</span>
                  </span>
                  {capture.recordLabel && (
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-faint">{capture.recordRef}</span>
                      {capture.recordLabel}
                    </span>
                  )}
                  {capture.workflowState && (
                    <span className="flex items-center gap-1.5">
                      <Workflow size={12} className="flex-none text-faint" />
                      {capture.workflowState}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <User size={12} className="flex-none text-faint" />
                    role, recent activity & timestamp captured on submit
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={submit}
              disabled={!body.trim()}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-40"
            >
              <Send size={14} />
              Send feedback
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Send feedback"
        aria-expanded={open}
        className={`flex size-11 items-center justify-center rounded-full shadow-card transition-colors ${
          open ? "bg-ink text-panel" : "bg-accent text-accent-ink hover:brightness-105"
        }`}
      >
        {open ? <X size={18} /> : <MessageSquarePlus size={18} />}
      </button>
    </div>
  );
}
