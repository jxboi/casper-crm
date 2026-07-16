import { JsonViewer, type PlaygroundManifest, type PlaygroundScenarioProps } from "@casper/playground-kit";
import { actionMatches } from "./actions.js";
import { BUILTIN_ROLES, ROLE_GRANTS, type BuiltinRole } from "./roles.js";

const ACTIONS = ["record.create", "record.update", "record.archive", "member.invite", "member.role_change", "workspace.create", "workflow.publish"] as const;

function CanExplorer({ searchParams }: PlaygroundScenarioProps) {
  const role = BUILTIN_ROLES.includes(searchParams.role as BuiltinRole) ? (searchParams.role as BuiltinRole) : "member";
  const action = ACTIONS.includes(searchParams.action as (typeof ACTIONS)[number]) ? searchParams.action! : "record.update";
  const grants = ROLE_GRANTS[role].filter((grant) => actionMatches(grant.action, action));
  const decision = grants.length > 0
    ? { allow: true, reason: `role '${role}' grants '${action}'`, scopes: grants.map((grant) => grant.scope) }
    : { allow: false, reason: `role '${role}' has no grant for '${action}'`, scopes: [] };
  return <section>
    <h2>can() explorer</h2>
    <p className="status">Explore the same built-in grant table and wildcard matcher used by the database-backed can() gate.</p>
    <form method="get"><input type="hidden" name="scenario" value="can" />
      <label>Role<select name="role" defaultValue={role}>{BUILTIN_ROLES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Action<select name="action" defaultValue={action}>{ACTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <button type="submit">Evaluate permission</button>
    </form>
    <JsonViewer value={{ role, action, decision }} />
  </section>;
}

export const playground: PlaygroundManifest = { title: "casper-auth playground", scenarios: [{ path: "can", label: "can() explorer", component: CanExplorer }] };
