import { createUIMessageStreamResponse } from "ai";

import { subscribeActiveChatStream } from "@/src/lib/chat-stream-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }

  const stream = subscribeActiveChatStream(sessionId);
  if (!stream) {
    return new Response(null, { status: 204 });
  }

  return createUIMessageStreamResponse({ stream });
}
