import { type Migration, tenantRlsSql } from "@casper/platform";

/**
 * casper-ai DDL. Run state, run steps, and daily budget counters are all org
 * tenant data and get org RLS (`tenantRlsSql`) — a run and its audit trail are
 * never visible cross-tenant even under an app-code bug. The app role's DML comes
 * from the platform bootstrap's default privileges — no per-table grants needed.
 */
export const aiMigrations: Migration[] = [
  {
    module: "ai",
    version: 1,
    name: "ai_run_engine",
    sql: `
      CREATE TABLE ai_runs (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        assistant_key text NOT NULL,
        author_kind text NOT NULL,
        author_id uuid NOT NULL,
        status text NOT NULL DEFAULT 'intake',
        request text NOT NULL,
        plan jsonb,
        changeset_id uuid,
        model_id text,
        prompt_version text,
        input_tokens integer NOT NULL DEFAULT 0,
        output_tokens integer NOT NULL DEFAULT 0,
        cost_usd text NOT NULL DEFAULT '0',
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ai_runs_ws_idx ON ai_runs (workspace_id, status);

      CREATE TABLE ai_run_steps (
        id uuid PRIMARY KEY,
        run_id uuid NOT NULL,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        position integer NOT NULL DEFAULT 0,
        type text NOT NULL,
        payload jsonb NOT NULL,
        input_tokens integer NOT NULL DEFAULT 0,
        output_tokens integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ai_run_steps_run_idx ON ai_run_steps (run_id, position);

      CREATE TABLE ai_budget_counters (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        assistant_key text NOT NULL,
        day date NOT NULL,
        tokens integer NOT NULL DEFAULT 0,
        cost_usd text NOT NULL DEFAULT '0',
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ai_budget_day_uniq UNIQUE (org_id, assistant_key, day)
      );

      ${tenantRlsSql("ai_runs")}
      ${tenantRlsSql("ai_run_steps")}
      ${tenantRlsSql("ai_budget_counters")}
    `,
  },
];
