import { getProject } from "@/src/db/queries";
import { rerunWorkflowJob } from "@/src/github/app";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id, jobId } = await params;
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

  const numericJobId = Number(jobId);
  if (!Number.isSafeInteger(numericJobId) || numericJobId <= 0) {
    return Response.json({ error: "invalid workflow job ID" }, { status: 400 });
  }

  try {
    await rerunWorkflowJob({
      installationId: project.githubInstallationId,
      owner: project.owner,
      repo: project.name,
      jobId: numericJobId,
    });
    return Response.json({ ok: true });
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
