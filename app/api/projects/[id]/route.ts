import { deleteProject, getProject } from "@/src/db/queries";
import { serializeProject } from "@/src/lib/api-serializers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  return Response.json({ project: serializeProject(project) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }

  const deleted = deleteProject(id);
  if (!deleted) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  return Response.json({ project: serializeProject(project) });
}
