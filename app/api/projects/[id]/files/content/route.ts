import { ensureWorkspaceRootAt, resolveInWorkspace } from "@/src/agent/sandbox";
import { READ_FILE_MAX_BYTES, readTextFileSnapshot } from "@/src/agent/tools/edit-utils";
import { getProject } from "@/src/db/queries";
import type { ProjectFileContentSummary } from "@/src/lib/api-types";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  if (project.status !== "ready") {
    return Response.json({ error: "project is not ready" }, { status: 400 });
  }

  const filePath = new URL(req.url).searchParams.get("path");
  if (!filePath) {
    return Response.json({ error: "path is required" }, { status: 400 });
  }

  try {
    const root = ensureWorkspaceRootAt(project.localPath);
    const abs = resolveInWorkspace(filePath, root);
    const snapshot = await readTextFileSnapshot(abs, READ_FILE_MAX_BYTES);
    const summary: ProjectFileContentSummary = {
      projectId: project.id,
      path: filePath,
      content: snapshot.content,
      sizeBytes: snapshot.sizeBytes,
      sha256: snapshot.sha256,
    };
    return Response.json({ file: summary });
  } catch (err) {
    return Response.json(
      { error: redactText(errorMessage(err)) },
      { status: 500 },
    );
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
