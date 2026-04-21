import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { DEFAULT_MODEL, openrouter } from "@/src/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT =
  "You are Anton, a focused coding assistant. Answer concisely, use fenced code blocks for code, and prefer short, correct answers over long, hedged ones.";

export async function POST(req: Request) {
  const { messages, model }: { messages: UIMessage[]; model?: string } =
    await req.json();

  const result = streamText({
    model: openrouter(model ?? DEFAULT_MODEL),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
