import { stageOf } from "@/lib/pipeline";
import type { StageKey } from "@/lib/types";

export function StageBadge({ stage }: { stage: StageKey }) {
  const s = stageOf(stage);
  const tone =
    s.category === "won"
      ? "bg-won-soft text-won"
      : s.category === "lost"
        ? "bg-lost-soft text-lost"
        : "bg-panel-2 text-muted";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] ${tone}`}>
      {s.name}
    </span>
  );
}

export function NeglectBadge({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null;
  return (
    <span
      title={reasons.join(" · ")}
      className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-warn"
    >
      <span className="size-1.5 rounded-full bg-warn" />
      neglected
    </span>
  );
}
