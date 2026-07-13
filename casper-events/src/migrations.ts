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
        subject_id text NOT NULL,
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
        subject_id text NOT NULL,
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
        record_id text NOT NULL,
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
        subject_id text,
        data jsonb NOT NULL,
        occurred_at timestamptz NOT NULL
      );

      ${tenantRlsSql("domain_events")}
      ${tenantRlsSql("audit_log")}
      ${tenantRlsSql("timeline_entries")}
      ${tenantRlsSql("interaction_events")}
    `,
  },
  {
    module: "events",
    version: 2,
    name: "comments_notifications",
    sql: `
      CREATE TABLE comments (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        record_type text NOT NULL,
        record_id text NOT NULL,
        author_id uuid NOT NULL,
        body text NOT NULL,
        mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL,
        edited_at timestamptz,
        deleted_at timestamptz
      );
      CREATE INDEX comments_record_idx ON comments (record_type, record_id, created_at);

      CREATE TABLE notifications (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        user_id uuid NOT NULL,
        type text NOT NULL,
        title text NOT NULL,
        body text,
        subject_type text,
        subject_id text,
        source_event_id uuid NOT NULL,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        read_at timestamptz,
        created_at timestamptz NOT NULL
      );
      CREATE INDEX notifications_inbox_idx ON notifications (user_id, read_at, created_at);
      CREATE UNIQUE INDEX notifications_dedupe ON notifications (source_event_id, user_id, type);

      ${tenantRlsSql("comments")}
      ${tenantRlsSql("notifications")}
    `,
  },
];
