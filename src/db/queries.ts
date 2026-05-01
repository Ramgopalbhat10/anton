import { asc, desc, eq, sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { randomUUID } from "node:crypto";

import { db } from "./client";
import {
  githubInstallations,
  memories,
  messages,
  projects,
  sessions,
  workspaceSettings,
  type GithubInstallation,
  type Memory,
  type Project,
  type Session,
  type WorkspaceSettings,
} from "./schema";

export type StoredMessage<UI extends UIMessage = UIMessage> = {
  id: string;
  sessionId: string;
  role: UI["role"];
  parts: UI["parts"];
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

  return rows.map((row) => {
    const parts = row.parts as UI["parts"];
    return {
      id: row.id,
      role: row.role as UI["role"],
      parts,
    } as UI;
  });
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

