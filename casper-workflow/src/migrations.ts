import { type Migration, tenantRlsSql } from "@casper/platform";

/**
 * casper-workflow DDL. `workflow_definitions` and `automation_definitions` are
 * org-global config snapshots (like records' `record_types`) — versioned, no tenant
 * RLS. `automation_runs` is the workspace-scoped **run log** (tenant RLS): the
 * automation consumer enqueues `pending` rows in the dispatch tx and a post-commit
 * driver drains them. The unique (automation_id, trigger_event_id) makes at-least-once
 * dispatch idempotent; `depth` (causation-chain length) powers loop protection.
 */
export const workflowMigrations: Migration[] = [
  {
    module: "workflow",
    version: 1,
    name: "workflow_definitions",
    sql: `
      CREATE TABLE workflow_definitions (
        record_type text NOT NULL,
        version integer NOT NULL,
        status text NOT NULL DEFAULT 'active',
        definition jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (record_type, version)
      );

      GRANT SELECT ON workflow_definitions TO casper_app;
    `,
  },
  {
    module: "workflow",
    version: 2,
    name: "automation_engine",
    sql: `
      CREATE TABLE automation_definitions (
        id text NOT NULL,
        version integer NOT NULL,
        record_type text,
        enabled boolean NOT NULL DEFAULT true,
        definition jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (id, version)
      );
      GRANT SELECT ON automation_definitions TO casper_app;

      CREATE TABLE automation_runs (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        automation_id text NOT NULL,
        trigger_event_id uuid NOT NULL,
        record_type text,
        record_id text,
        status text NOT NULL,
        depth integer NOT NULL DEFAULT 0,
        condition_result boolean,
        effects jsonb,
        error text,
        started_at timestamptz,
        finished_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (automation_id, trigger_event_id)
      );
      CREATE INDEX automation_runs_status_idx ON automation_runs (workspace_id, status);

      ${tenantRlsSql("automation_runs")}
    `,
  },
];
