import { pgTable, uuid, text, integer, jsonb, date, timestamp, index, unique } from "drizzle-orm/pg-core";

/**
 * casper-ai persistence. Assistant *definitions* are an in-memory registry
 * (seeded from product modules — see registry.ts), like record types and
 * workflow config; only run state and budget counters are persisted here.
 *
 * `ai_runs` + `ai_run_steps` are the audit source of truth (D-016): every model
 * turn, tool call (inputs/outputs), token count and cost is a step row,
 * independent of the UI stream. A run only ever produces a *draft* change set
 * (`changeset_id`); commit stays a human action in casper-changesets, so there
 * is no path from model output to a committed write inside this module.
 *
 * All three tables are org tenant data (org-scoped RLS, declared in migrations.ts).
 */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    assistantKey: text("assistant_key").notNull(),
    // Requesting principal (the human who launched the run).
    authorKind: text("author_kind").notNull(),
    authorId: uuid("author_id").notNull(),
    status: text("status").notNull().default("intake"),
    request: text("request").notNull(),
    plan: jsonb("plan"),
    changesetId: uuid("changeset_id"),
    modelId: text("model_id"),
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // Money as text to avoid float drift; parsed at the edges.
    costUsd: text("cost_usd").notNull().default("0"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ wsIdx: index("ai_runs_ws_idx").on(t.workspaceId, t.status) }),
);

export const aiRunSteps = pgTable(
  "ai_run_steps",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id").notNull(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    position: integer("position").notNull().default(0),
    // model_turn | tool_call | user_msg | system
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ runIdx: index("ai_run_steps_run_idx").on(t.runId, t.position) }),
);

export const aiBudgetCounters = pgTable(
  "ai_budget_counters",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    assistantKey: text("assistant_key").notNull(),
    day: date("day").notNull(),
    tokens: integer("tokens").notNull().default(0),
    costUsd: text("cost_usd").notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ dayUniq: unique("ai_budget_day_uniq").on(t.orgId, t.assistantKey, t.day) }),
);
