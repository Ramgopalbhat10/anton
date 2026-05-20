import { getProject } from "@/src/db/queries";
import { listOpenIssuesForRepository } from "@/src/github/app";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  if (
    project.provider !== "github" ||
    project.githubInstallationId === null ||
    project.status !== "ready"
  ) {
    return Response.json({ issues: [] });
  }

  try {
    const issues = await listOpenIssuesForRepository({
      installationId: project.githubInstallationId,
      owner: project.owner,
      repo: project.name,
    });
    return Response.json({ issues });
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
