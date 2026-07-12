import { ArrowRightLeft, Bot, Cog, FileText, Mail, MessageSquarePlus, PlusCircle, StickyNote, Zap } from "lucide-react";
import type { TimelineEvent } from "@/lib/types";
import { dateShort } from "@/lib/format";

const ICON: Record<string, typeof Bot> = {
  "deal.created": PlusCircle,
  "deal.stage_changed": ArrowRightLeft,
  "record.updated": Cog,
  "record.neglected": Zap,
  "task.created": FileText,
  "note.added": StickyNote,
  "email.received": Mail,
  "artifact.saved": FileText,
  "automation.executed": Cog,
  "feedback.submitted": MessageSquarePlus,
  "feedback.triaged": MessageSquarePlus,
};

function sourceTone(source: TimelineEvent["source"]) {
  if (source === "ai") return "text-accent";
  if (source === "automation") return "text-warn";
  if (source === "system") return "text-lost";
  return "text-muted";
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  const sorted = [...events].sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <ol className="flex flex-col">
      {sorted.map((e, i) => {
        const Icon = ICON[e.type] ?? Bot;
        return (
          <li key={e.id} className="flex gap-3">
            <div className="flex flex-none flex-col items-center">
              <span className="flex size-6 items-center justify-center rounded-full border border-line bg-panel">
                <Icon size={12} className={sourceTone(e.source)} />
              </span>
              {i < sorted.length - 1 && <span className="w-px flex-1 bg-line" />}
            </div>
            <div className="pb-4">
              <p className="text-[13px] leading-snug">{e.summary}</p>
              <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-faint">
                <span className={sourceTone(e.source)}>{e.type}</span>
                <span>·</span>
                <span>{e.actorName}</span>
                <span>·</span>
                <span>{dateShort(e.at)}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
