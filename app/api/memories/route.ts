import { z } from "zod";

import { createMemory, listMemories } from "@/src/db/queries";
import { serializeMemory } from "@/src/lib/api-serializers";

export const runtime = "nodejs";

const MAX_MEMORY_CHARS = 1000;

const memoryInputSchema = z.object({
  content: z.string().trim().min(1).max(MAX_MEMORY_CHARS),
});

export async function GET() {
  return Response.json({
    memories: listMemories(100).map(serializeMemory),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = memoryInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  return Response.json(
    { memory: serializeMemory(createMemory(parsed.data.content)) },
    { status: 201 },
  );
}
