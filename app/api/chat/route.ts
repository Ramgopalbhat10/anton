import { convertToModelMessages } from "ai";
import { z } from "zod";

import { runAgent, type AntonUIMessage } from "@/src/agent/loop";
import type { PermissionMode } from "@/src/agent/permissions";
import {
  addSessionTokens,
  createSession,
  deriveTitleFromMessages,
  getProject,
  getSession,
  replaceMessages,
  setSessionProject,
  touchSession,
} from "@/src/db/queries";
import { DEFAULT_MODEL } from "@/src/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  model: z.string().min(1).optional(),
  permissionMode: z.enum(["default", "auto-review", "full-access"]).optional(),
  messages: z.array(z.unknown()).min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { sessionId } = parsed.data;
  const uiMessages = parsed.data.messages as AntonUIMessage[];
  const model = parsed.data.model ?? DEFAULT_MODEL;

  const existing = getSession(sessionId);
  const projectId = existing?.projectId ?? parsed.data.projectId ?? null;
  if (!projectId) {
    return Response.json(
      { error: "projectId is required for agent chat sessions" },
      { status: 400 },
    );
  }

  const project = getProject(projectId);
  if (!project || project.status !== "ready") {
    return Response.json(
      { error: "project not found or not ready" },
      { status: 400 },
    );
  }

  if (!existing) {
    createSession({
      id: sessionId,
      title: deriveTitleFromMessages(uiMessages),
      model,
      projectId,
    });
  } else {
    if (!existing.projectId && projectId) {
      setSessionProject(sessionId, projectId);
    }
    if (existing.model !== model) {
      touchSession(sessionId, model);
    }
  }

  const result = await runAgent({
    messages: await convertToModelMessages(uiMessages),
    model,
    workspaceRoot: project.localPath,
    permissionMode: parsed.data.permissionMode as PermissionMode | undefined,
    onFinish: ({ totalUsage }) => {
      const delta = totalUsage.totalTokens;
      if (typeof delta === "number" && delta > 0) {
        addSessionTokens(sessionId, delta);
      }
    },
  });

  return result.toUIMessageStreamResponse<AntonUIMessage>({
    originalMessages: uiMessages,
    onFinish: ({ messages, isAborted }) => {
      if (isAborted) return;
      replaceMessages<AntonUIMessage>(sessionId, messages);
    },
  });
}
