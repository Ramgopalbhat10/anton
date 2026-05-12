import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { randomUUID } from "node:crypto";

import { hydrateMessagesWithRunMetrics, type AntonUIMessage } from "@/src/lib/trace";
import { db } from "./client";
import {
  githubInstallations,
  memories,
  messages,
  mcpServers,
  mcpTrustDecisions,
  projects,
  runEvents,
  runs,
  sessions,
  toolApprovals,
  toolCalls,
  workspaceSettings,
  type GithubInstallation,
  type Memory,
  type McpServer,
  type McpTrustDecision,
  type NewMcpServer,
  type NewRun,
  type NewRunEvent,
  type NewToolApproval,
  type NewToolCall,
  type Project,
  type Run,
  type RunEvent,
  type Session,
  type ToolApproval,
  type ToolCall,
  type WorkspaceSettings,
} from "./schema";
import {
  fingerprintMcpConfig,
  namespaceFromDisplayName,
  normalizeMcpConfig,
  preserveRedactedMcpConfigValues,
  type McpServerConfig,
} from "@/src/agent/mcp-config";

export type StoredMessage<UI extends UIMessage = UIMessage> = {
  id: string;
  sessionId: string;
  role: UI["role"];
  parts: UI["parts"];
  metadata: UI["metadata"] | null;
  createdAt: Date;
};

export function listSessions(): Session[] {
  return db.select().from(sessions).orderBy(desc(sessions.updatedAt)).all();
}

export function getSession(id: string): Session | undefined {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

export function sessionExists(id: string): boolean {
  return getSession(id) !== undefined;
}

export function createSession(input: {
  id: string;
  title: string;
  model: string;
  projectId?: string | null;
}): Session {
  const now = new Date();
  const row: Session = {
    ...input,
    projectId: input.projectId ?? null,
    tokensTotal: 0,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(sessions).values(row).run();
  return row;
}

export function addSessionTokens(id: string, delta: number): void {
  if (!Number.isFinite(delta) || delta <= 0) return;
  db
    .update(sessions)
    .set({
      tokensTotal: sql`${sessions.tokensTotal} + ${Math.round(delta)}`,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, id))
    .run();
}

export function touchSession(id: string, model?: string): void {
  const update: { updatedAt: Date; model?: string } = { updatedAt: new Date() };
  if (model) update.model = model;
  db.update(sessions).set(update).where(eq(sessions.id, id)).run();
}

export function setSessionProject(
  id: string,
  projectId: string | null,
): Session | undefined {
  db
    .update(sessions)
    .set({ projectId, updatedAt: new Date() })
    .where(eq(sessions.id, id))
    .run();
  return getSession(id);
}

export function renameSession(id: string, title: string): Session | undefined {
  const trimmed = title.trim();
  if (!trimmed) return getSession(id);
  db
    .update(sessions)
    .set({ title: trimmed, updatedAt: new Date() })
    .where(eq(sessions.id, id))
    .run();
  return getSession(id);
}

export function deleteSession(id: string): void {
  db.delete(sessions).where(eq(sessions.id, id)).run();
}

const WORKSPACE_SETTINGS_ID = "local";

export function getWorkspaceSettings(): WorkspaceSettings {
  const existing = db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.id, WORKSPACE_SETTINGS_ID))
    .get();
  if (existing) return existing;

  const now = new Date();
  const row: WorkspaceSettings = {
    id: WORKSPACE_SETTINGS_ID,
    localWorkspacesRoot: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(workspaceSettings).values(row).run();
  return row;
}

export function updateWorkspaceSettings(input: {
  localWorkspacesRoot: string | null;
}): WorkspaceSettings {
  getWorkspaceSettings();
  db
    .update(workspaceSettings)
    .set({
      localWorkspacesRoot: input.localWorkspacesRoot,
      updatedAt: new Date(),
    })
    .where(eq(workspaceSettings.id, WORKSPACE_SETTINGS_ID))
    .run();
  return getWorkspaceSettings();
}

export function listGithubInstallations(): GithubInstallation[] {
  return db
    .select()
    .from(githubInstallations)
    .orderBy(desc(githubInstallations.updatedAt))
    .all();
}

export function getGithubInstallationByInstallationId(
  installationId: number,
): GithubInstallation | undefined {
  return db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .get();
}

export function upsertGithubInstallation(input: {
  installationId: number;
  accountLogin: string;
  accountType: string;
}): GithubInstallation {
  const now = new Date();
  const existing = getGithubInstallationByInstallationId(input.installationId);
  if (existing) {
    db
      .update(githubInstallations)
      .set({
        accountLogin: input.accountLogin,
        accountType: input.accountType,
        updatedAt: now,
      })
      .where(eq(githubInstallations.id, existing.id))
      .run();
    return db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.id, existing.id))
      .get() as GithubInstallation;
  }

  const row: GithubInstallation = {
    id: randomUUID(),
    installationId: input.installationId,
    accountLogin: input.accountLogin,
    accountType: input.accountType,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(githubInstallations).values(row).run();
  return row;
}

export function listProjects(): Project[] {
  return db.select().from(projects).orderBy(desc(projects.updatedAt)).all();
}

export function getProject(id: string): Project | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export function getProjectByGithubRepoId(
  githubRepoId: number,
): Project | undefined {
  return db
    .select()
    .from(projects)
    .where(eq(projects.githubRepoId, githubRepoId))
    .get();
}

export function upsertProject(input: {
  githubRepoId: number;
  githubInstallationId: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string;
  localPath: string;
  status: Project["status"];
  lastError?: string | null;
}): Project {
  const now = new Date();
  const existing = getProjectByGithubRepoId(input.githubRepoId);
  if (existing) {
    db
      .update(projects)
      .set({
        githubInstallationId: input.githubInstallationId,
        owner: input.owner,
        name: input.name,
        fullName: input.fullName,
        defaultBranch: input.defaultBranch,
        cloneUrl: input.cloneUrl,
        localPath: input.localPath,
        status: input.status,
        lastError: input.lastError ?? null,
        updatedAt: now,
      })
      .where(eq(projects.id, existing.id))
      .run();
    return getProject(existing.id) as Project;
  }

  const row: Project = {
    id: randomUUID(),
    provider: "github",
    githubRepoId: input.githubRepoId,
    githubInstallationId: input.githubInstallationId,
    owner: input.owner,
    name: input.name,
    fullName: input.fullName,
    defaultBranch: input.defaultBranch,
    cloneUrl: input.cloneUrl,
    localPath: input.localPath,
    status: input.status,
    lastError: input.lastError ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(projects).values(row).run();
  return row;
}

export function updateProjectStatus(
  id: string,
  status: Project["status"],
  lastError: string | null = null,
): Project | undefined {
  db
    .update(projects)
    .set({ status, lastError, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .run();
  return getProject(id);
}

export function listMemories(limit = 20): Memory[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(100, Math.trunc(limit)))
    : 20;
  return db
    .select()
    .from(memories)
    .orderBy(desc(memories.updatedAt))
    .limit(safeLimit)
    .all();
}

export function createMemory(content: string): Memory {
  const now = new Date();
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("memory content must not be empty");
  }
  const row: Memory = {
    id: randomUUID(),
    content: trimmed,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(memories).values(row).run();
  return row;
}

export function updateMemory(id: string, content: string): Memory | undefined {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("memory content must not be empty");
  }
  db
    .update(memories)
    .set({ content: trimmed, updatedAt: new Date() })
    .where(eq(memories.id, id))
    .run();
  return db.select().from(memories).where(eq(memories.id, id)).get();
}

export function deleteMemory(id: string): boolean {
  const result = db.delete(memories).where(eq(memories.id, id)).run();
  return result.changes > 0;
}

export function loadMessages<UI extends UIMessage>(
  sessionId: string,
): UI[] {
  const rows = db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt))
    .all();

  const loaded = rows.map((row) => {
    const parts = row.parts as UI["parts"];
    return {
      id: row.id,
      role: row.role as UI["role"],
      parts,
      metadata: (row.metadata ?? undefined) as UI["metadata"],
    } as UI;
  });

  const sessionRuns = db
    .select({
      id: runs.id,
      inputTokens: runs.inputTokens,
      outputTokens: runs.outputTokens,
      totalTokens: runs.totalTokens,
      costUsd: runs.costUsd,
    })
    .from(runs)
    .where(eq(runs.sessionId, sessionId))
    .all();

  return hydrateMessagesWithRunMetrics(
    loaded as unknown as AntonUIMessage[],
    sessionRuns,
  ) as unknown as UI[];
}

export function replaceMessages<UI extends UIMessage>(
  sessionId: string,
  incoming: UI[],
): void {
  db.transaction((tx) => {
    tx.delete(messages).where(eq(messages.sessionId, sessionId)).run();
    if (incoming.length === 0) return;
    tx
      .insert(messages)
      .values(
        incoming.map((m, idx) => ({
          id: messageId(m, sessionId, idx),
          sessionId,
          role: m.role,
          parts: m.parts as unknown,
          metadata: (m.metadata ?? null) as unknown,
          // Preserve ordering even when created_at ticks collide.
          createdAt: new Date(Date.now() + idx),
        })),
      )
      .run();
    tx
      .update(sessions)
      .set({ updatedAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .run();
  });
}

export function createRun(input: NewRun): Run {
  db.insert(runs).values(input).run();
  return db.select().from(runs).where(eq(runs.id, input.id)).get() as Run;
}

export function updateRun(
  id: string,
  input: Partial<Omit<NewRun, "id" | "sessionId" | "model" | "startedAt">>,
): Run | undefined {
  db.update(runs).set(input).where(eq(runs.id, id)).run();
  return db.select().from(runs).where(eq(runs.id, id)).get();
}

export function upsertRunEvent(input: NewRunEvent): RunEvent {
  db
    .insert(runEvents)
    .values(input)
    .onConflictDoUpdate({
      target: runEvents.id,
      set: {
        status: input.status,
        label: input.label,
        summary: input.summary ?? null,
        finishedAt: input.finishedAt ?? null,
        durationMs: input.durationMs ?? null,
        toolCallId: input.toolCallId ?? null,
        details: input.details ?? null,
      },
    })
    .run();
  return db
    .select()
    .from(runEvents)
    .where(eq(runEvents.id, input.id))
    .get() as RunEvent;
}

export function getToolCall(id: string): ToolCall | undefined {
  return db.select().from(toolCalls).where(eq(toolCalls.id, id)).get();
}

export function listToolCallsForRun(runId: string): ToolCall[] {
  return db
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.runId, runId))
    .orderBy(asc(toolCalls.startedAt))
    .all();
}

export function upsertToolCall(input: NewToolCall): ToolCall {
  db
    .insert(toolCalls)
    .values(input)
    .onConflictDoUpdate({
      target: toolCalls.id,
      set: {
        toolName: input.toolName,
        stepNumber: input.stepNumber ?? null,
        status: input.status,
        inputSummary: input.inputSummary ?? null,
        approvalDecision: input.approvalDecision ?? null,
        outputSummary: input.outputSummary ?? null,
        exitCode: input.exitCode ?? null,
        error: input.error ?? null,
        finishedAt: input.finishedAt ?? null,
        durationMs: input.durationMs ?? null,
      },
    })
    .run();
  return getToolCall(input.id) as ToolCall;
}

export function updateToolCall(
  id: string,
  input: Partial<Omit<NewToolCall, "id" | "runId" | "toolCallId" | "startedAt">>,
): ToolCall | undefined {
  db.update(toolCalls).set(input).where(eq(toolCalls.id, id)).run();
  return getToolCall(id);
}

export function getToolApproval(id: string): ToolApproval | undefined {
  return db.select().from(toolApprovals).where(eq(toolApprovals.id, id)).get();
}

export function upsertToolApproval(input: NewToolApproval): ToolApproval {
  db
    .insert(toolApprovals)
    .values(input)
    .onConflictDoUpdate({
      target: toolApprovals.id,
      set: {
        approvalId: input.approvalId ?? null,
        decision: input.decision,
        title: input.title,
        summary: input.summary,
        riskCategories: input.riskCategories,
        metadata: input.metadata ?? null,
        respondedAt: input.respondedAt ?? null,
        reason: input.reason ?? null,
      },
    })
    .run();
  return getToolApproval(input.id) as ToolApproval;
}

export function listMcpServers(): McpServer[] {
  return db.select().from(mcpServers).orderBy(asc(mcpServers.displayName)).all();
}

export function listEnabledMcpServers(ids?: string[]): McpServer[] {
  if (ids && ids.length === 0) return [];
  const enabledFilter = eq(mcpServers.enabled, true);
  const where =
    ids && ids.length > 0
      ? and(enabledFilter, inArray(mcpServers.id, ids))
      : enabledFilter;
  return db.select().from(mcpServers).where(where).orderBy(asc(mcpServers.displayName)).all();
}

export function getMcpServer(id: string): McpServer | undefined {
  return db.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
}

export function createMcpServer(input: {
  displayName: string;
  transport: McpServer["transport"];
  config: McpServerConfig;
  enabled?: boolean;
}): McpServer {
  const now = new Date();
  const displayName = input.displayName.trim();
  const row: NewMcpServer = {
    id: randomUUID(),
    displayName,
    namespace: uniqueMcpNamespace(namespaceFromDisplayName(displayName)),
    transport: input.transport,
    config: normalizeMcpConfig(input.config) as unknown,
    enabled: input.enabled ?? true,
    lastStatus: "untested",
    lastError: null,
    lastCheckedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(mcpServers).values(row).run();
  return getMcpServer(row.id) as McpServer;
}

export function updateMcpServer(
  id: string,
  input: {
    displayName?: string;
    transport?: McpServer["transport"];
    config?: McpServerConfig;
    enabled?: boolean;
  },
): McpServer | undefined {
  const current = getMcpServer(id);
  if (!current) return undefined;

  const displayName = input.displayName?.trim() ?? current.displayName;
  const update: Partial<NewMcpServer> = {
    displayName,
    enabled: input.enabled ?? current.enabled,
    updatedAt: new Date(),
  };
  if (displayName !== current.displayName) {
    update.namespace = uniqueMcpNamespace(
      namespaceFromDisplayName(displayName),
      current.id,
    );
  }
  if (input.transport) update.transport = input.transport;
  if (input.config) {
    update.config = normalizeMcpConfig(
      preserveRedactedMcpConfigValues(
        input.config,
        current.config as McpServerConfig,
      ),
    ) as unknown;
    update.lastStatus = "untested";
    update.lastError = null;
    update.lastCheckedAt = null;
  }

  db.update(mcpServers).set(update).where(eq(mcpServers.id, id)).run();
  return getMcpServer(id);
}

export function deleteMcpServer(id: string): boolean {
  const result = db.delete(mcpServers).where(eq(mcpServers.id, id)).run();
  return result.changes > 0;
}

export function updateMcpServerStatus(
  id: string,
  status: McpServer["lastStatus"],
  error: string | null,
): McpServer | undefined {
  db
    .update(mcpServers)
    .set({
      lastStatus: status,
      lastError: error,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(mcpServers.id, id))
    .run();
  return getMcpServer(id);
}

export function getMcpTrustDecision(
  mcpServerId: string,
  fingerprint: string,
): McpTrustDecision | undefined {
  return db
    .select()
    .from(mcpTrustDecisions)
    .where(
      and(
        eq(mcpTrustDecisions.mcpServerId, mcpServerId),
        eq(mcpTrustDecisions.fingerprint, fingerprint),
      ),
    )
    .get();
}

export function isMcpServerTrusted(server: McpServer): boolean {
  const fingerprint = fingerprintMcpConfig(server.config as McpServerConfig);
  return getMcpTrustDecision(server.id, fingerprint)?.decision === "approved";
}

export function upsertMcpTrustDecision(input: {
  mcpServerId: string;
  fingerprint: string;
  decision: "approved" | "denied";
}): McpTrustDecision {
  const now = new Date();
  const existing = getMcpTrustDecision(input.mcpServerId, input.fingerprint);
  if (existing) {
    db
      .update(mcpTrustDecisions)
      .set({ decision: input.decision, updatedAt: now })
      .where(eq(mcpTrustDecisions.id, existing.id))
      .run();
    return getMcpTrustDecision(input.mcpServerId, input.fingerprint) as McpTrustDecision;
  }

  const row = {
    id: randomUUID(),
    mcpServerId: input.mcpServerId,
    fingerprint: input.fingerprint,
    decision: input.decision,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(mcpTrustDecisions).values(row).run();
  return getMcpTrustDecision(input.mcpServerId, input.fingerprint) as McpTrustDecision;
}

export function deriveTitleFromMessages(
  incoming: Pick<UIMessage, "role" | "parts">[],
): string {
  const firstUser = incoming.find((m) => m.role === "user");
  if (!firstUser) return "New chat";
  for (const part of firstUser.parts) {
    if (part.type === "text" && typeof part.text === "string") {
      const cleaned = part.text.replace(/\s+/g, " ").trim();
      if (cleaned.length === 0) continue;
      return cleaned.length > 60 ? `${cleaned.slice(0, 57).trimEnd()}…` : cleaned;
    }
  }
  return "New chat";
}

function messageId<UI extends UIMessage>(
  message: UI,
  sessionId: string,
  index: number,
): string {
  const id = message.id.trim();
  if (id.length > 0) return id;
  return `${sessionId}:message:${index}`;
}

function uniqueMcpNamespace(base: string, currentId?: string): string {
  const existing = listMcpServers().filter((server) => server.id !== currentId);
  const namespaces = new Set(existing.map((server) => server.namespace));
  if (!namespaces.has(base)) return base;

  let suffix = 2;
  while (namespaces.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

