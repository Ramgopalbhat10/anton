import { asc, desc, eq, sql } from "drizzle-orm";
import type { UIMessage } from "ai";

import { db } from "./client";
import { messages, sessions, type Session } from "./schema";

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
}): Session {
  const now = new Date();
  const row: Session = {
    ...input,
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
          id: m.id,
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

