/**
 * Row-level security helper (D-002 — belt-and-braces). The primary tenant guard
 * is app-level scoping through the tenancy context + `can()`; these policies make
 * cross-tenant reads fail *even if application code has a bug*. `withTx` sets the
 * `app.org_id` / `app.bypass_rls` session variables this policy reads.
 *
 * FORCE is essential: PGlite/Postgres table owners bypass RLS otherwise, and the
 * migration runner (and prod) connect as the owner.
 */
export function tenantRlsSql(table: string, orgColumn = "org_id"): string {
  const policy = `${table}_tenant_isolation`;
  return `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ${policy} ON ${table};
CREATE POLICY ${policy} ON ${table}
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR ${orgColumn}::text = current_setting('app.org_id', true)
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR ${orgColumn}::text = current_setting('app.org_id', true)
  );`.trim();
}
