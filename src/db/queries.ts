import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { randomUUID } from "node:crypto";

import {
  collapseAssistantContinuationMessages,
  hydrateMessagesWithRunState,
  hydrateMessagesWithToolCallState,
  type AntonUIMessage,
} from "@/src/lib/trace";
import { db } from "./client";
import {
  backgroundCommandSessions,
  githubInstallations,
  memories,
  messages,
  mcpServers,
  mcpTrustDecisions,
  projects,
  runContextSummaries,
  runEvents,
  runs,
  sessions,
  toolApprovals,
  toolCalls,
  workspaceSettings,
  type BackgroundCommandSession,
  type GithubInstallation,
  type Memory,
  type McpServer,
  type McpTrustDecision,
  type NewBackgroundCommandSession,
  type NewMcpServer,
  type NewRun,
  type NewRunContextSummary,
  type NewRunEvent,
  type NewToolApproval,
  type NewToolCall,
  type Project,
  type Run,
  type RunContextSummary,
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

export class MessagePersistenceConflictError extends Error {
  constructor(message = "session message history changed before persistence") {
    super(message);
    this.name = "MessagePersistenceConflictError";
  }
}

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
    tokenBudgetMultiplier: 1,
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

export function sessionHasStoredMessages(sessionId: string): boolean {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .get();
  return (row?.count ?? 0) > 0;
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
    defaultModel: null,
    defaultMaxSteps: null,
    defaultPermissionMode: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(workspaceSettings).values(row).run();
  return row;
}

export function updateWorkspaceSettings(input: {
  localWorkspacesRoot?: string | null;
  defaultModel?: string | null;
  defaultMaxSteps?: number | null;
  defaultPermissionMode?: "default" | "auto-review" | "full-access" | null;
}): WorkspaceSettings {
  getWorkspaceSettings();
  const update: Partial<WorkspaceSettings> = { updatedAt: new Date() };
  if ("localWorkspacesRoot" in input) {
    update.localWorkspacesRoot = input.localWorkspacesRoot ?? null;
  }
  if ("defaultModel" in input) {
    update.defaultModel = input.defaultModel ?? null;
  }
  if ("defaultMaxSteps" in input) {
    update.defaultMaxSteps = input.defaultMaxSteps ?? null;
  }
  if ("defaultPermissionMode" in input) {
    update.defaultPermissionMode = input.defaultPermissionMode ?? null;
  }
  db
    .update(workspaceSettings)
    .set(update)
    .where(eq(workspaceSettings.id, WORKSPACE_SETTINGS_ID))
    .run();
  return getWorkspaceSettings();
}

export function getLastRunForProject(projectId: string): Run | undefined {
  const projectSessions = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .all();
  const sessionIds = projectSessions.map((session) => session.id);
  if (sessionIds.length === 0) return undefined;

  return db
    .select()
    .from(runs)
    .where(inArray(runs.sessionId, sessionIds))
    .orderBy(desc(runs.startedAt))
    .limit(1)
    .get();
}

export function getRunById(id: string): Run | undefined {
  return db.select().from(runs).where(eq(runs.id, id)).get();
}

export function listRunsForSession(sessionId: string): Run[] {
  return db
    .select()
    .from(runs)
    .where(eq(runs.sessionId, sessionId))
    .orderBy(asc(runs.startedAt))
    .all();
}

export function setSessionTokenBudgetMultiplier(
  sessionId: string,
  multiplier: number,
): Session | undefined {
  db
    .update(sessions)
    .set({ tokenBudgetMultiplier: multiplier, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId))
    .run();
  return getSession(sessionId);
}

export function listAssistantTurnRunIds(
  sessionId: string,
  anchorRunId: string,
): string[] {
  const sessionRuns = db
    .select({ id: runs.id, finishReason: runs.finishReason })
    .from(runs)
    .where(eq(runs.sessionId, sessionId))
    .orderBy(asc(runs.startedAt))
    .all();

  const anchorIndex = sessionRuns.findIndex((run) => run.id === anchorRunId);
  if (anchorIndex === -1) return [anchorRunId];

  let startIndex = anchorIndex;
  while (
    startIndex > 0 &&
    sessionRuns[startIndex - 1]?.finishReason === "token_budget_limit"
  ) {
    startIndex -= 1;
  }

  return sessionRuns.slice(startIndex, anchorIndex + 1).map((run) => run.id);
}

export function getRunForProject(
  projectId: string,
  runId: string,
): Run | undefined {
  const projectSessions = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .all();
  const sessionIds = projectSessions.map((session) => session.id);
  if (sessionIds.length === 0) return undefined;

  return db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), inArray(runs.sessionId, sessionIds)))
    .get();
}

export function listRunEventsForRun(runId: string): RunEvent[] {
  return db
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.sequence))
    .all();
}

export function getRunContextSummaryByRunId(
  runId: string,
): RunContextSummary | undefined {
  return db
    .select()
    .from(runContextSummaries)
    .where(eq(runContextSummaries.runId, runId))
    .get();
}

export function listToolApprovalsForRun(runId: string): ToolApproval[] {
  const calls = listToolCallsForRun(runId);
  if (calls.length === 0) return [];
  const callIds = calls.map((call) => call.id);
  return db
    .select()
    .from(toolApprovals)
    .where(inArray(toolApprovals.toolCallId, callIds))
    .orderBy(asc(toolApprovals.requestedAt))
    .all();
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

export function getProjectByLocalPath(localPath: string): Project | undefined {
  return db
    .select()
    .from(projects)
    .where(eq(projects.localPath, localPath))
    .get();
}

export function upsertProject(input: {
  githubRepoId: number;
  githubInstallationId: number | null;
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

export function createLocalProject(input: {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string | null;
  localPath: string;
}): Project {
  const existing = getProjectByLocalPath(input.localPath);
  if (existing) return existing;

  const now = new Date();
  const row: Project = {
    id: randomUUID(),
    provider: "local",
    githubRepoId: null,
    githubInstallationId: null,
    owner: input.owner,
    name: input.name,
    fullName: input.fullName,
    defaultBranch: input.defaultBranch,
    cloneUrl: input.cloneUrl,
    localPath: input.localPath,
    status: "ready",
    lastError: null,
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

export function updateGithubProjectMetadata(input: {
  id: string;
  githubRepoId: number;
  githubInstallationId: number | null;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string;
  status: Project["status"];
  lastError?: string | null;
}): Project | undefined {
  db
    .update(projects)
    .set({
      githubRepoId: input.githubRepoId,
      githubInstallationId: input.githubInstallationId,
      owner: input.owner,
      name: input.name,
      fullName: input.fullName,
      defaultBranch: input.defaultBranch,
      cloneUrl: input.cloneUrl,
      status: input.status,
      lastError: input.lastError ?? null,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, input.id))
    .run();
  return getProject(input.id);
}

export function deleteProject(id: string): boolean {
  return db.transaction((tx) => {
    tx
      .update(sessions)
      .set({ projectId: null, updatedAt: new Date() })
      .where(eq(sessions.projectId, id))
      .run();
    const result = tx.delete(projects).where(eq(projects.id, id)).run();
    return result.changes > 0;
  });
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
  const collapsed = collapseAssistantContinuationMessages(
    loaded as unknown as AntonUIMessage[],
  );

  const sessionRuns = db
    .select()
    .from(runs)
    .where(eq(runs.sessionId, sessionId))
    .orderBy(asc(runs.startedAt))
    .all();

  const sessionRunEvents =
    sessionRuns.length === 0
      ? []
      : db
          .select()
          .from(runEvents)
          .where(
            inArray(
              runEvents.runId,
              sessionRuns.map((run) => run.id),
            ),
          )
          .orderBy(asc(runEvents.runId), asc(runEvents.sequence))
          .all();

  const sessionToolCalls =
    sessionRuns.length === 0
      ? []
      : db
          .select({
            toolCallId: toolCalls.toolCallId,
            status: toolCalls.status,
            approvalDecision: toolCalls.approvalDecision,
          })
          .from(toolCalls)
          .where(
            inArray(
              toolCalls.runId,
              sessionRuns.map((run) => run.id),
            ),
          )
          .orderBy(asc(toolCalls.startedAt))
          .all();

  const withRunState = hydrateMessagesWithRunState(
    collapsed,
    sessionRuns,
    sessionRunEvents,
  );

  return hydrateMessagesWithToolCallState(
    withRunState,
    sessionToolCalls,
  ) as unknown as UI[];
}

export function getActiveRunForSession(
  sessionId: string,
  staleAfterMs: number,
): Run | undefined {
  const cutoff = Date.now() - staleAfterMs;
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.sessionId, sessionId), eq(runs.status, "running")))
    .orderBy(desc(runs.startedAt))
    .all()
    .find((run) => run.startedAt.getTime() >= cutoff);
}

export function getMessagePersistenceConflict<UI extends UIMessage>(
  sessionId: string,
  incoming: UI[],
  options: {
    mutableTailCount?: number;
    allowExtraAssistantTail?: boolean;
  } = {},
): { storedCount: number; incomingCount: number } | undefined {
  const stored = storedMessagesForConflict(sessionId);
  if (stored.length > incoming.length) {
    if (
      incoming.length === 0 ||
      !options.allowExtraAssistantTail ||
      stored
        .slice(incoming.length)
        .some((message) => message.role !== "assistant")
    ) {
      return { storedCount: stored.length, incomingCount: incoming.length };
    }
    const stableIncomingCount = Math.max(0, incoming.length - 1);
    for (const [idx, storedMessage] of stored
      .slice(0, stableIncomingCount)
      .entries()) {
      if (storedMessage.id !== messageId(incoming[idx], sessionId, idx)) {
        return { storedCount: stored.length, incomingCount: incoming.length };
      }
    }
    const incomingTailId = messageId(
      incoming[incoming.length - 1],
      sessionId,
      incoming.length - 1,
    );
    const storedTail = stored[incoming.length - 1];
    const extraTail = stored.slice(incoming.length);
    if (
      storedTail?.id !== incomingTailId &&
      extraTail.every((message) => message.id !== incomingTailId)
    ) {
      return { storedCount: stored.length, incomingCount: incoming.length };
    }
    return undefined;
  }

  const storedIds = stored.map((message) => message.id);
  if (storedIds.length > incoming.length) {
    return { storedCount: stored.length, incomingCount: incoming.length };
  }

  const mutableTailCount = Math.min(
    options.mutableTailCount ?? 0,
    storedIds.length,
    incoming.length,
  );
  const stableCount = storedIds.length - mutableTailCount;

  for (const [idx, storedId] of storedIds.slice(0, stableCount).entries()) {
    if (storedId !== messageId(incoming[idx], sessionId, idx)) {
      return { storedCount: stored.length, incomingCount: incoming.length };
    }
  }

  return undefined;
}

export function saveMessagesIncrementally<UI extends UIMessage>(
  sessionId: string,
  incoming: UI[],
  options: { pruneExtraAssistantTail?: boolean } = {},
): void {
  db.transaction((tx) => {
    const existing = tx
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt))
      .all();

    const now = Date.now();
    const existingById = new Map(existing.map((row) => [row.id, row]));
    for (const [idx, message] of incoming.entries()) {
      const id = messageId(message, sessionId, idx);
      const row = {
        id,
        sessionId,
        role: message.role,
        parts: message.parts as unknown,
        metadata: (message.metadata ?? null) as unknown,
      };

      const current = existing[idx]?.id === id
        ? existing[idx]
        : existingById.get(id);
      if (!current) {
        tx.insert(messages)
          .values({
            ...row,
            createdAt: new Date(now + idx),
          })
          .run();
        continue;
      }

      if (
        current.role === row.role &&
        stableJson(current.parts) === stableJson(row.parts) &&
        stableJson(current.metadata) === stableJson(row.metadata)
      ) {
        continue;
      }

      tx.update(messages)
        .set({
          role: row.role,
          parts: row.parts,
          metadata: row.metadata,
        })
        .where(eq(messages.id, id))
        .run();
    }

    if (options.pruneExtraAssistantTail) {
      const incomingIds = new Set(
        incoming.map((message, index) => messageId(message, sessionId, index)),
      );
      for (const current of existing) {
        if (incomingIds.has(current.id) || current.role !== "assistant") continue;
        tx.delete(messages).where(eq(messages.id, current.id)).run();
      }
    }

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

export function upsertRunContextSummary(
  input: NewRunContextSummary,
): RunContextSummary {
  db
    .insert(runContextSummaries)
    .values(input)
    .onConflictDoUpdate({
      target: runContextSummaries.runId,
      set: {
        sessionId: input.sessionId,
        summary: input.summary,
        facts: input.facts,
        files: input.files,
        commands: input.commands,
        tools: input.tools,
        updatedAt: input.updatedAt ?? new Date(),
      },
    })
    .run();
  return db
    .select()
    .from(runContextSummaries)
    .where(eq(runContextSummaries.runId, input.runId))
    .get() as RunContextSummary;
}

export function listRunContextSummariesForSession(
  sessionId: string,
  limit = 50,
): RunContextSummary[] {
  return db
    .select()
    .from(runContextSummaries)
    .where(eq(runContextSummaries.sessionId, sessionId))
    .orderBy(desc(runContextSummaries.createdAt))
    .limit(limit)
    .all();
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

function storedMessagesForConflict(
  sessionId: string,
): { id: string; role: string }[] {
  const stored = db
    .select({
      id: messages.id,
      role: messages.role,
      parts: messages.parts,
      metadata: messages.metadata,
    })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt))
    .all();

  return collapseAssistantContinuationMessages(
    stored.map((message) => ({
      id: message.id,
      role: message.role as AntonUIMessage["role"],
      parts: message.parts as AntonUIMessage["parts"],
      metadata: (message.metadata ?? undefined) as AntonUIMessage["metadata"],
    })),
  ).map((message) => ({ id: message.id, role: message.role }));
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function uniqueMcpNamespace(base: string, currentId?: string): string {
  const existing = listMcpServers().filter((server) => server.id !== currentId);
  const namespaces = new Set(existing.map((server) => server.namespace));
  if (!namespaces.has(base)) return base;

  let suffix = 2;
  while (namespaces.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

const ACTIVE_BACKGROUND_COMMAND_STATUSES = [
  "starting",
  "running",
  "stopping",
] as const;

export function markStaleBackgroundCommandSessions(): void {
  const now = new Date();
  db.update(backgroundCommandSessions)
    .set({
      status: "stale",
      pid: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      inArray(backgroundCommandSessions.status, [...ACTIVE_BACKGROUND_COMMAND_STATUSES]),
    )
    .run();
}

export function createBackgroundCommandSession(
  input: NewBackgroundCommandSession,
): BackgroundCommandSession {
  const now = new Date();
  const row: BackgroundCommandSession = {
    ...input,
    pid: input.pid ?? null,
    startedAt: input.startedAt ?? now,
    finishedAt: input.finishedAt ?? null,
    exitCode: input.exitCode ?? null,
    signal: input.signal ?? null,
    stdoutTail: input.stdoutTail ?? "",
    stderrTail: input.stderrTail ?? "",
    detectedUrls: input.detectedUrls ?? [],
    createdBy: input.createdBy ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
  db.insert(backgroundCommandSessions).values(row).run();
  return row;
}

export function getBackgroundCommandSession(
  id: string,
): BackgroundCommandSession | undefined {
  return db
    .select()
    .from(backgroundCommandSessions)
    .where(eq(backgroundCommandSessions.id, id))
    .get();
}

export function getRunningBackgroundCommandForProject(
  projectId: string,
  command: string,
): BackgroundCommandSession | undefined {
  return db
    .select()
    .from(backgroundCommandSessions)
    .where(
      and(
        eq(backgroundCommandSessions.projectId, projectId),
        eq(backgroundCommandSessions.command, command),
        inArray(backgroundCommandSessions.status, [
          ...ACTIVE_BACKGROUND_COMMAND_STATUSES,
        ]),
      ),
    )
    .orderBy(desc(backgroundCommandSessions.startedAt))
    .get();
}

export function listBackgroundCommandSessionsForProject(
  projectId: string,
  limit: number,
): BackgroundCommandSession[] {
  return db
    .select()
    .from(backgroundCommandSessions)
    .where(eq(backgroundCommandSessions.projectId, projectId))
    .orderBy(desc(backgroundCommandSessions.startedAt))
    .limit(limit)
    .all();
}

export function updateBackgroundCommandSession(
  id: string,
  patch: Partial<
    Pick<
      BackgroundCommandSession,
      | "status"
      | "pid"
      | "startedAt"
      | "finishedAt"
      | "exitCode"
      | "signal"
      | "stdoutTail"
      | "stderrTail"
      | "detectedUrls"
    >
  >,
): BackgroundCommandSession | undefined {
  db.update(backgroundCommandSessions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(backgroundCommandSessions.id, id))
    .run();
  return getBackgroundCommandSession(id);
}

export function clearRecentBackgroundCommandSessions(projectId: string): number {
  const result = db
    .delete(backgroundCommandSessions)
    .where(
      and(
        eq(backgroundCommandSessions.projectId, projectId),
        notInArray(backgroundCommandSessions.status, [
          ...ACTIVE_BACKGROUND_COMMAND_STATUSES,
        ]),
      ),
    )
    .run();
  return result.changes;
}

