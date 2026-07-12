import type { Deal, Risk, Role, StageCategory, StageKey } from "@/lib/types";

/** Frozen demo clock — the engine never reads the wall clock (D-014). */
export const DEMO_NOW = new Date("2026-07-12T09:00:00+08:00");

export type Stage = {
  key: StageKey;
  name: string;
  category: StageCategory;
  /** dwell threshold in days before the SLA scan flags neglect */
  maxStageAgeDays?: number;
};

export type Guard =
  | { kind: "required_fields"; fields: (keyof Deal)[]; labels: string[] }
  | { kind: "permission"; roles: Role[]; label: string };

export type Transition = {
  from: StageKey[];
  to: StageKey;
  label?: string;
  guards: Guard[];
};

/** The casper-sales deal pipeline as casper-workflow config (v4, active). */
export const PIPELINE = {
  key: "deal-pipeline",
  version: 4,
  stages: [
    { key: "new", name: "New", category: "open", maxStageAgeDays: 7 },
    { key: "qualified", name: "Qualified", category: "open", maxStageAgeDays: 14 },
    { key: "proposal", name: "Proposal", category: "open", maxStageAgeDays: 10 },
    { key: "negotiation", name: "Negotiation", category: "open", maxStageAgeDays: 7 },
    { key: "won", name: "Won", category: "won" },
    { key: "lost", name: "Lost", category: "lost" },
  ] as Stage[],
  transitions: [
    { from: ["new"], to: "qualified", guards: [] },
    {
      from: ["qualified"],
      to: "proposal",
      guards: [
        {
          kind: "required_fields",
          fields: ["amount", "expectedCloseDate"],
          labels: ["amount", "expected close date"],
        },
      ],
    },
    { from: ["proposal"], to: "negotiation", guards: [] },
    { from: ["negotiation"], to: "won", guards: [] },
    {
      from: ["new", "qualified", "proposal", "negotiation"],
      to: "lost",
      guards: [{ kind: "required_fields", fields: ["lostReason"], labels: ["lost reason"] }],
    },
    {
      from: ["won", "lost"],
      to: "qualified",
      label: "re-open",
      guards: [{ kind: "permission", roles: ["manager"], label: "Manager or above" }],
    },
  ] as Transition[],
} as const;

export const NEGLECT_ACTIVITY_DAYS = 14;

export function stageOf(key: StageKey): Stage {
  return PIPELINE.stages.find((s) => s.key === key)!;
}

export function transitionFor(from: StageKey, to: StageKey): Transition | undefined {
  return PIPELINE.transitions.find((t) => t.to === to && t.from.includes(from));
}

export function legalTargets(deal: Deal): { to: StageKey; transition: Transition }[] {
  return PIPELINE.transitions
    .filter((t) => t.from.includes(deal.stage))
    .map((t) => ({ to: t.to, transition: t }));
}

/** Pure guard evaluation — returns human-readable issues; empty means the move is legal. */
export function guardIssues(
  deal: Deal,
  to: StageKey,
  actorRole: Role,
  extras?: { lostReason?: string }
): string[] {
  const t = transitionFor(deal.stage, to);
  if (!t) return [`No transition ${stageOf(deal.stage).name} → ${stageOf(to).name} in pipeline v${PIPELINE.version}`];
  const issues: string[] = [];
  for (const g of t.guards) {
    if (g.kind === "required_fields") {
      g.fields.forEach((f, i) => {
        const value = f === "lostReason" && extras?.lostReason ? extras.lostReason : deal[f];
        if (value === null || value === undefined || value === "") {
          issues.push(`Guard: ${g.labels[i]} is required to enter ${stageOf(to).name}`);
        }
      });
    } else if (g.kind === "permission") {
      if (!g.roles.includes(actorRole)) {
        issues.push(`Guard: re-opening a closed deal requires ${g.label} — can() denies ${actorRole}`);
      }
    }
  }
  return issues;
}

export function daysBetween(fromIso: string, to: Date): number {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

/** SLA/neglect rules from casper-sales config: open AND (no activity ≥ 14d OR
    next action overdue OR stage dwell > stage threshold). */
export function neglectReasons(deal: Deal, now: Date = DEMO_NOW): string[] {
  const stage = stageOf(deal.stage);
  if (stage.category !== "open") return [];
  const reasons: string[] = [];
  const silentDays = daysBetween(deal.lastActivityAt, now);
  if (silentDays >= NEGLECT_ACTIVITY_DAYS) reasons.push(`no activity for ${silentDays} days`);
  if (deal.nextActionDate && new Date(deal.nextActionDate) < now) {
    reasons.push(`next action overdue since ${deal.nextActionDate}`);
  }
  const dwell = daysBetween(deal.stageEnteredAt, now);
  if (stage.maxStageAgeDays !== undefined && dwell > stage.maxStageAgeDays) {
    reasons.push(`${dwell} days in ${stage.name} (threshold ${stage.maxStageAgeDays})`);
  }
  return reasons;
}

export const RISK_OF_OP: Record<string, Risk> = {
  create_task: "medium",
  update_field: "medium",
  email_draft: "low",
};
