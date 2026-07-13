import { now, withTx } from "@casper/platform";
import { dispatchPending, emit } from "@casper/events";
import { listRecords, type Filter } from "@casper/records";
import { getWorkflow } from "./registry.js";
import type { SlaRule, WorkflowDefinition } from "./definition.js";

/**
 * SLA / staleness scan (P1a). A cron-callable function (casper-api wires the cron in
 * P1b) that finds records breaching a workflow's declarative SLA rules and emits the
 * configured event. "Neglect" is defined *here* as config — the sales assistant and
 * notifications consume `workflow.sla_breached` / `record.neglected`, rather than
 * hardcoding staleness. Reuses the records Filter AST → SQL; no new query code.
 *
 * Runs workspace-scoped: the caller establishes a `requestContext` (a system
 * principal + the workspace) and iterates workspaces. `emit` and `listRecords` both
 * read org/workspace from that context.
 */
export interface SlaBreach {
  ruleKey: string;
  recordId: string;
  kind: SlaRule["kind"];
  event: SlaRule["event"];
}

/** Translate an SLA rule into a records Filter (column-backed or JSONB). */
export function slaRuleToFilter(defn: WorkflowDefinition, rule: SlaRule): Filter {
  if (rule.kind === "inactivity") {
    const inactive: Filter = {
      field: "last_activity_at",
      op: "no_activity_within",
      value: rule.threshold,
    };
    return rule.stage
      ? { and: [inactive, { field: defn.stageField, op: "eq", value: rule.stage }] }
      : inactive;
  }
  // stage_age — how long the record has sat in its current stage.
  const conds: Filter[] = [
    { field: defn.stageEnteredAtField, op: "older_than", value: rule.threshold },
  ];
  if (rule.stage) conds.unshift({ field: defn.stageField, op: "eq", value: rule.stage });
  return { and: conds };
}

export async function scanSla(input: { type: string }): Promise<SlaBreach[]> {
  const defn = getWorkflow(input.type);
  const breaches: SlaBreach[] = [];

  for (const rule of defn.sla) {
    const filter = slaRuleToFilter(defn, rule);
    const { records } = await listRecords({ type: input.type, filter });
    for (const rec of records) {
      const stage = (rec.data[defn.stageField] as string | undefined) ?? null;
      await withTx((tx) =>
        emit(tx, {
          type: rule.event,
          subject: { type: input.type, id: rec.id },
          source: "system",
          payload: {
            rule: rule.key,
            kind: rule.kind,
            stage,
            breachedAt: now().toISOString(),
          },
        }),
      );
      breaches.push({ ruleKey: rule.key, recordId: rec.id, kind: rule.kind, event: rule.event });
    }
    await dispatchPending();
  }

  return breaches;
}
