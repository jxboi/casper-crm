/**
 * Terminology map (casper-sales plan §Scope): engine-generic terms → sales terms for
 * UI copy, consumed by casper-web as a lightweight i18n-style layer. Record-type names
 * already live on the `RecordTypeDef`s; this covers the generic engine nouns/verbs the
 * UI surfaces around them (owner, stage, timeline, the transition verb).
 */
export interface Terminology {
  /** Generic engine term → product label. */
  terms: Record<string, string>;
  /** Product-facing verb for a stage transition. */
  transitionVerb: string;
}

export const salesTerminology: Terminology = {
  terms: {
    record: "deal",
    owner: "Deal owner",
    stage: "Stage",
    timeline: "Activity",
    view: "List",
    "record.neglected": "Needs attention",
  },
  transitionVerb: "Move stage",
};

/** Resolve a generic term to its sales label, falling back to the key. */
export function salesTerm(key: string): string {
  return salesTerminology.terms[key] ?? key;
}
