import { type Migration, tenantRlsSql } from "@casper/platform";

export const eventsMigrations: Migration[] = [
  {
    module: "events",
    version: 1,
    name: "event_backbone",
    sql: `
      CREATE TABLE domain_events (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        type text NOT NULL,
        subject_type text NOT NULL,
        subject_id uuid NOT NULL,
        actor_kind text NOT NULL,
        actor_id uuid NOT NULL,
        source text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        correlation_id uuid NOT NULL,
        causation_id uuid,
        dispatched_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX domain_events_undispatched_idx ON domain_events (dispatched_at, id);
      CREATE INDEX domain_events_subject_idx ON domain_events (subject_type, subject_id);

      CREATE TABLE audit_log (
        event_id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        type text NOT NULL,
        subject_type text NOT NULL,
        subject_id uuid NOT NULL,
        actor_kind text NOT NULL,
        actor_id uuid NOT NULL,
        source text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL
      );
      CREATE INDEX audit_log_subject_idx ON audit_log (subject_type, subject_id);

      CREATE TABLE timeline_entries (
        event_id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        record_type text NOT NULL,
        record_id uuid NOT NULL,
        kind text NOT NULL,
        actor_kind text NOT NULL,
        actor_id uuid NOT NULL,
        summary text NOT NULL,
        data jsonb NOT NULL,
        occurred_at timestamptz NOT NULL
      );
      CREATE INDEX timeline_record_idx ON timeline_entries (record_type, record_id, occurred_at);

      CREATE TABLE interaction_events (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        type text NOT NULL,
        actor_kind text NOT NULL,
        actor_id uuid NOT NULL,
        subject_type text,
        subject_id uuid,
        data jsonb NOT NULL,
        occurred_at timestamptz NOT NULL
      );

      ${tenantRlsSql("domain_events")}
      ${tenantRlsSql("audit_log")}
      ${tenantRlsSql("timeline_entries")}
      ${tenantRlsSql("interaction_events")}
    `,
  },
];
