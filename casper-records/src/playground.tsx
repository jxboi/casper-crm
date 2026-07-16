import { JsonViewer, type PlaygroundManifest, type PlaygroundScenarioProps } from "@casper/playground-kit";
import type { Filter, FilterOp } from "./filter.js";

const OPS: FilterOp[] = ["eq", "neq", "contains", "gt", "lt", "is_empty", "within_last"];

function FilterBuilder({ searchParams }: PlaygroundScenarioProps) {
  const field = searchParams.field ?? "status";
  const op = OPS.includes(searchParams.op as FilterOp) ? (searchParams.op as FilterOp) : "eq";
  const rawValue = searchParams.value ?? "open";
  const filter: Filter = op === "is_empty"
    ? { field, op, value: true }
    : { field, op, value: op === "within_last" ? { amount: Number(rawValue) || 7, unit: "day" } : rawValue };
  return <section>
    <h2>Filter AST builder</h2>
    <p className="status">The emitted object is the same AST consumed by record queries, saved views, automations, and assistant tools.</p>
    <form method="get">
      <input type="hidden" name="scenario" value="filter" />
      <label>Field<input name="field" defaultValue={field} /></label>
      <label>Operator<select name="op" defaultValue={op}>{OPS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Value<input name="value" defaultValue={rawValue} disabled={op === "is_empty"} /></label>
      <button type="submit">Build AST</button>
    </form>
    <JsonViewer value={filter} />
  </section>;
}

export const playground: PlaygroundManifest = {
  title: "casper-records playground",
  scenarios: [{ path: "filter", label: "Filter AST", component: FilterBuilder }],
};
