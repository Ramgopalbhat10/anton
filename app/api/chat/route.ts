import { convertToModelMessages } from "ai";
import { z } from "zod";

import { runAgent, type AntonUIMessage } from "@/src/agent/loop";
import {
  addSessionTokens,
  createSession,
  deriveTitleFromMessages,
  getSession,
  replaceMessages,
  touchSession,
} from "@/src/db/queries";
import { DEFAULT_MODEL } from "@/src/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  sessionId: z.string().min(1),
  model: z.string().min(1).optional(),
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
  if (!existing) {
    createSession({
      id: sessionId,
      title: deriveTitleFromMessages(uiMessages),
      model,
    });
  } else if (existing.model !== model) {
    touchSession(sessionId, model);
  }

  const result = await runAgent({
    messages: await convertToModelMessages(uiMessages),
    model,
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
