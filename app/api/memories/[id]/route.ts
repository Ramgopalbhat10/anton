import { z } from "zod";

import { deleteMemory, updateMemory } from "@/src/db/queries";
import { serializeMemory } from "@/src/lib/api-serializers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const MAX_MEMORY_CHARS = 1000;

const memoryInputSchema = z.object({
  content: z.string().trim().min(1).max(MAX_MEMORY_CHARS),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = memoryInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const memory = updateMemory(id, parsed.data.content);
  if (!memory) {
    return Response.json({ error: "memory not found" }, { status: 404 });
  }

  return Response.json({ memory: serializeMemory(memory) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!deleteMemory(id)) {
    return Response.json({ error: "memory not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
