import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import { getProject } from "@/src/db/queries";
import { redactText } from "@/src/lib/redaction";
import { buildProjectGitStatusSummary } from "@/src/workspace/git-status";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  if (project.status !== "ready") {
    return Response.json({ error: "project is not ready" }, { status: 400 });
  }

  try {
    const root = ensureWorkspaceRootAt(project.localPath);
    const summary = await buildProjectGitStatusSummary(project, root);
    return Response.json({ status: summary });
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
