import { z } from "zod";

import {
  deleteSession,
  getSession,
  loadMessages,
  renameSession,
} from "@/src/db/queries";
import type { AntonUIMessage } from "@/src/lib/trace";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }
  const messages = loadMessages<AntonUIMessage>(id);
  return Response.json({
    session: {
      id: session.id,
      title: session.title,
      model: session.model,
      projectId: session.projectId,
      createdAt: session.createdAt.getTime(),
      updatedAt: session.updatedAt.getTime(),
    },
    messages,
  });
}

const patchSchema = z.object({
  title: z.string().min(1).max(200),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getSession(id)) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const updated = renameSession(id, parsed.data.title);
  if (!updated) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }
  return Response.json({
    session: {
      id: updated.id,
      title: updated.title,
      model: updated.model,
      projectId: updated.projectId,
      createdAt: updated.createdAt.getTime(),
      updatedAt: updated.updatedAt.getTime(),
    },
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getSession(id)) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }
  deleteSession(id);
  return new Response(null, { status: 204 });
}
