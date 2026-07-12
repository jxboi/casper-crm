"use client";

import { useEffect } from "react";
import { useStore, type Toast } from "@/lib/store";

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast);
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), 4500);
    return () => clearTimeout(t);
  }, [toast.id, dismiss]);

  const tone =
    toast.kind === "ok"
      ? "border-won/40 text-ink"
      : toast.kind === "warn"
        ? "border-warn/50 text-ink"
        : "border-lost/50 text-ink";
  const dot = toast.kind === "ok" ? "bg-won" : toast.kind === "warn" ? "bg-warn" : "bg-lost";

  return (
    <div className={`rise flex max-w-md items-start gap-2.5 rounded-lg border bg-panel px-3.5 py-2.5 text-[13px] shadow-card ${tone}`}>
      <span className={`mt-1.5 size-1.5 flex-none rounded-full ${dot}`} />
      <span>{toast.text}</span>
      <button onClick={() => dismiss(toast.id)} className="ml-1 text-faint hover:text-ink" aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  );
}
