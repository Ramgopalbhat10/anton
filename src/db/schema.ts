import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { OpenRouterRoutingPreferences } from "@/src/lib/api-types";

export const workspaceSettings = sqliteTable("workspace_settings", {
  id: text("id").primaryKey(),
  localWorkspacesRoot: text("local_workspaces_root"),
  defaultModel: text("default_model"),
  defaultMaxSteps: integer("default_max_steps"),
  defaultPermissionMode: text("default_permission_mode", {
    enum: ["default", "auto-review", "full-access"],
  }),
  openRouterRoutingPreferences: text("openrouter_routing_preferences", {
    mode: "json",
  }).$type<OpenRouterRoutingPreferences | null>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

export const githubInstallations = sqliteTable("github_installations", {
  id: text("id").primaryKey(),
  installationId: integer("installation_id").notNull().unique(),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    provider: text("provider", { enum: ["github", "local"] }).notNull(),
    githubRepoId: integer("github_repo_id"),
    githubInstallationId: integer("github_installation_id"),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    cloneUrl: text("clone_url"),
    localPath: text("local_path").notNull(),
    status: text("status", {
      enum: ["cloning", "ready", "error"],
    }).notNull(),
    lastError: text("last_error"),
    environmentEnabled: integer("environment_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => [
    uniqueIndex("projects_github_repo_id_unique").on(table.githubRepoId),
    uniqueIndex("projects_local_path_unique").on(table.localPath),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    model: text("model").notNull(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    tokenBudgetMultiplier: integer("token_budget_multiplier").notNull().default(1),
    tokensTotal: integer("tokens_total").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => [
    index("sessions_updated_at_idx").on(table.updatedAt),
    index("sessions_project_id_idx").on(table.projectId),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    parts: text("parts", { mode: "json" }).notNull(),
    metadata: text("metadata", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => [index("messages_session_id_idx").on(table.sessionId)],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    provider: text("provider"),
    status: text("status", {
      enum: ["running", "completed", "error", "aborted"],
    }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: real("cost_usd"),
    costMetadata: text("cost_metadata", { mode: "json" }),
    stepCount: integer("step_count"),
    finishReason: text("finish_reason"),
  },
  (table) => [
    index("runs_session_id_idx").on(table.sessionId),
    index("runs_started_at_idx").on(table.startedAt),
  ],
);

export const toolCalls = sqliteTable(
  "tool_calls",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    stepNumber: integer("step_number"),
    status: text("status", {
      enum: ["running", "completed", "error", "denied"],
    }).notNull(),
    inputSummary: text("input_summary"),
    approvalDecision: text("approval_decision", {
      enum: ["pending", "approved", "denied"],
    }),
    outputSummary: text("output_summary"),
    exitCode: integer("exit_code"),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("tool_calls_run_id_idx").on(table.runId),
    uniqueIndex("tool_calls_run_tool_call_id_unique").on(
      table.runId,
      table.toolCallId,
    ),
    index("tool_calls_started_at_idx").on(table.startedAt),
  ],
);

export const toolApprovals = sqliteTable(
  "tool_approvals",
  {
    id: text("id").primaryKey(),
    toolCallId: text("tool_call_id")
      .notNull()
      .references(() => toolCalls.id, { onDelete: "cascade" }),
    approvalId: text("approval_id"),
    decision: text("decision", {
      enum: ["pending", "approved", "denied"],
    }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    riskCategories: text("risk_categories", { mode: "json" }).notNull(),
    metadata: text("metadata", { mode: "json" }),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
    respondedAt: integer("responded_at", { mode: "timestamp_ms" }),
    reason: text("reason"),
  },
  (table) => [
    index("tool_approvals_tool_call_id_idx").on(table.toolCallId),
    index("tool_approvals_approval_id_idx").on(table.approvalId),
  ],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    kind: text("kind", {
      enum: ["step", "reasoning", "tool", "approval", "error", "progress"],
    }).notNull(),
    status: text("status", {
      enum: ["running", "completed", "waiting", "error", "denied"],
    }).notNull(),
    label: text("label").notNull(),
    summary: text("summary"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),
    toolCallId: text("tool_call_id"),
    details: text("details", { mode: "json" }),
  },
  (table) => [
    index("run_events_run_id_sequence_idx").on(table.runId, table.sequence),
    index("run_events_tool_call_id_idx").on(table.toolCallId),
  ],
);

export const runContextSummaries = sqliteTable(
  "run_context_summaries",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => runs.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    facts: text("facts", { mode: "json" }).notNull(),
    files: text("files", { mode: "json" }).notNull(),
    commands: text("commands", { mode: "json" }).notNull(),
    tools: text("tools", { mode: "json" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => [
    index("run_context_summaries_session_id_idx").on(table.sessionId),
    index("run_context_summaries_created_at_idx").on(table.createdAt),
  ],
);

export const mcpServers = sqliteTable(
  "mcp_servers",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    namespace: text("namespace").notNull(),
    transport: text("transport", { enum: ["stdio", "http", "sse"] }).notNull(),
    config: text("config", { mode: "json" }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastStatus: text("last_status", {
      enum: ["untested", "ok", "error"],
    }).notNull().default("untested"),
    lastError: text("last_error"),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => [uniqueIndex("mcp_servers_namespace_unique").on(table.namespace)],
);

export const mcpTrustDecisions = sqliteTable(
  "mcp_trust_decisions",
  {
    id: text("id").primaryKey(),
    mcpServerId: text("mcp_server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    decision: text("decision", { enum: ["approved", "denied"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => [
    uniqueIndex("mcp_trust_decisions_server_fingerprint_unique").on(
      table.mcpServerId,
      table.fingerprint,
    ),
    index("mcp_trust_decisions_server_idx").on(table.mcpServerId),
  ],
);

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    content: text("content").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => [index("memories_updated_at_idx").on(table.updatedAt)],
);

export const backgroundCommandSessions = sqliteTable(
  "background_command_sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    commandKind: text("command_kind", { enum: ["script", "custom"] }).notNull(),
    status: text("status", {
      enum: [
        "starting",
        "running",
        "stopping",
        "exited",
        "failed",
        "stopped",
        "stale",
      ],
    }).notNull(),
    pid: integer("pid"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    exitCode: integer("exit_code"),
    signal: text("signal"),
    stdoutTail: text("stdout_tail").notNull().default(""),
    stderrTail: text("stderr_tail").notNull().default(""),
    detectedUrls: text("detected_urls", { mode: "json" })
      .notNull()
      .$type<string[]>()
      .default(sql`'[]'`),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => [
    index("background_command_sessions_project_id_idx").on(table.projectId),
    index("background_command_sessions_status_idx").on(table.status),
    index("background_command_sessions_project_started_idx").on(
      table.projectId,
      table.startedAt,
    ),
  ],
);

export type WorkspaceSettings = typeof workspaceSettings.$inferSelect;
export type NewWorkspaceSettings = typeof workspaceSettings.$inferInsert;
export type GithubInstallation = typeof githubInstallations.$inferSelect;
export type NewGithubInstallation = typeof githubInstallations.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunEvent = typeof runEvents.$inferSelect;
export type NewRunEvent = typeof runEvents.$inferInsert;
export type RunContextSummary = typeof runContextSummaries.$inferSelect;
export type NewRunContextSummary = typeof runContextSummaries.$inferInsert;
export type ToolCall = typeof toolCalls.$inferSelect;
export type NewToolCall = typeof toolCalls.$inferInsert;
export type ToolApproval = typeof toolApprovals.$inferSelect;
export type NewToolApproval = typeof toolApprovals.$inferInsert;
export type McpServer = typeof mcpServers.$inferSelect;
export type NewMcpServer = typeof mcpServers.$inferInsert;
export type McpTrustDecision = typeof mcpTrustDecisions.$inferSelect;
export type NewMcpTrustDecision = typeof mcpTrustDecisions.$inferInsert;
export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type BackgroundCommandSession =
  typeof backgroundCommandSessions.$inferSelect;
export type NewBackgroundCommandSession =
  typeof backgroundCommandSessions.$inferInsert;
