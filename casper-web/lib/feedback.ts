import { PIPELINE, stageOf } from "@/lib/pipeline";
import type { Deal, FeedbackStatus, FeedbackTarget } from "@/lib/types";

/* Pure helpers for the contextual feedback widget: derive the screen label,
   the target options, and the workflow state from the current route + record.
   Kept side-effect free so the widget stays lean and the capture is testable. */

export const FEEDBACK_STATUSES: FeedbackStatus[] = ["new", "acknowledged", "planned", "done"];

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  planned: "Planned",
  done: "Done",
};

/** Tailwind tone classes per status — reuses the semantic tokens. */
export const STATUS_TONE: Record<FeedbackStatus, string> = {
  new: "bg-accent-soft text-accent",
  acknowledged: "bg-warn-soft text-warn",
  planned: "bg-panel-2 text-muted",
  done: "bg-won-soft text-won",
};

/** Parse a RecordRef route into its deal id, if any (/deals/<id>). */
export function dealIdFromRoute(route: string): string | null {
  const m = /^\/deals\/([^/]+)$/.exec(route);
  return m ? m[1] : null;
}

const SCREEN_LABEL: Record<string, string> = {
  "/pipeline": "Pipeline",
  "/deals": "Deals",
  "/companies": "Companies",
  "/contacts": "Contacts",
  "/approvals": "Approvals inbox",
  "/feedback": "Feedback triage",
};

export type Capture = {
  route: string;
  screen: string;
  recordRef: string | null;
  recordLabel: string | null;
  workflowState: string | null;
};

/** Build the auto-captured, route-derived slice of feedback context. */
export function captureFor(route: string, deal: Deal | undefined): Capture {
  const dealId = dealIdFromRoute(route);
  if (dealId && deal) {
    return {
      route,
      screen: `Deal · ${deal.name}`,
      recordRef: `deal:${deal.id}`,
      recordLabel: deal.name,
      workflowState: `${PIPELINE.key} v${PIPELINE.version} · ${stageOf(deal.stage).name}`,
    };
  }
  const screen = SCREEN_LABEL[route] ?? route.replace(/^\//, "") ?? "App";
  return {
    route,
    screen,
    recordRef: null,
    recordLabel: null,
    workflowState: route === "/pipeline" ? `${PIPELINE.key} v${PIPELINE.version}` : null,
  };
}

/** Targets a user can point feedback at on the current screen (first = default). */
export function targetOptions(route: string): FeedbackTarget[] {
  const dealId = dealIdFromRoute(route);
  if (dealId) {
    return [
      { kind: "record", label: "This deal record" },
      { kind: "field", label: "A field on this record" },
      { kind: "stage", label: "The stage / transition control" },
      { kind: "view", label: "The timeline" },
    ];
  }
  switch (route) {
    case "/pipeline":
      return [
        { kind: "page", label: "This page" },
        { kind: "stage", label: "A pipeline column / stage" },
        { kind: "record", label: "A deal card" },
        { kind: "button", label: "Drag-and-drop transition" },
      ];
    case "/deals":
      return [
        { kind: "page", label: "This page" },
        { kind: "view", label: "The deals table" },
        { kind: "view", label: "A saved-view filter" },
        { kind: "record", label: "A table row" },
      ];
    case "/approvals":
      return [
        { kind: "page", label: "This page" },
        { kind: "record", label: "A proposed change" },
        { kind: "button", label: "Approve / commit control" },
      ];
    default:
      return [{ kind: "page", label: "This page" }];
  }
}
