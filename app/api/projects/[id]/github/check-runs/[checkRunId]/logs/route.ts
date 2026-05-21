import { getProject } from "@/src/db/queries";
import { getCheckRunLogs } from "@/src/github/app";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; checkRunId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, checkRunId } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  if (
    project.provider !== "github" ||
    project.githubInstallationId === null ||
    project.status !== "ready"
  ) {
    return Response.json({ error: "project is not a ready GitHub repository" }, { status: 400 });
  }

  const numericCheckRunId = Number(checkRunId);
  if (Number.isNaN(numericCheckRunId)) {
    return Response.json({ error: "invalid check run ID" }, { status: 400 });
  }

  try {
    const logs = await getCheckRunLogs({
      installationId: project.githubInstallationId,
      owner: project.owner,
      repo: project.name,
      checkRunId: numericCheckRunId,
    });
    return new Response(logs, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  } catch (err) {
    return Response.json(
      { error: redactText(errorMessage(err)) },
      { status: 502 },
    );
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
