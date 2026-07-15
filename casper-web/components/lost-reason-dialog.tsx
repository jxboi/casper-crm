"use client";

import { useEffect, useState } from "react";

/**
 * Collects the lost reason the pipeline guard requires before a deal can enter Lost.
 * Transport-agnostic: the parent supplies `onConfirm`, which runs the real transition
 * through the engine (see the pipeline page).
 */
export function LostReasonDialog({
  dealName,
  onConfirm,
  onClose,
}: {
  dealName: string;
  onConfirm: (reason: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    await onConfirm(reason.trim());
    setBusy(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Mark ${dealName} as Lost`}
        className="rise w-full max-w-sm rounded-xl border border-line bg-panel p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-[15px] font-semibold">Mark “{dealName}” as Lost</h3>
        <p className="mt-1 text-[12.5px] text-muted">
          The pipeline guard requires a lost reason before this transition can commit.
        </p>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. Budget cut, chose incumbent…"
          className="mt-3 w-full rounded-md border border-line bg-panel px-3 py-2 text-[13px] placeholder:text-faint"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-muted hover:text-ink">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!reason.trim() || busy}
            className="rounded-md bg-lost px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
          >
            Mark Lost
          </button>
        </div>
      </div>
    </div>
  );
}
