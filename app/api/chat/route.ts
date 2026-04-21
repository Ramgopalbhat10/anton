import { convertToModelMessages } from "ai";
import { runAgent, type AntonUIMessage } from "@/src/agent/loop";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { messages, model }: { messages: AntonUIMessage[]; model?: string } =
    await req.json();

  const result = runAgent({
    messages: await convertToModelMessages(messages),
    model,
  });

  return result.toUIMessageStreamResponse();
}
