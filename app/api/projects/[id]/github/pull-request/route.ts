import { z } from "zod";

import { getProject } from "@/src/db/queries";
import { findPullRequestForBranch } from "@/src/github/app";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const querySchema = z.object({
  branch: z.string().trim().min(1),
});

export async function GET(req: Request, { params }: Ctx) {
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
    return Response.json({ pullRequest: null });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    branch: url.searchParams.get("branch"),
  });
  if (!parsed.success) {
    return Response.json(
      { error: "invalid query", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  if (parsed.data.branch === project.defaultBranch) {
    return Response.json({ pullRequest: null });
  }

  try {
    const pullRequest = await findPullRequestForBranch({
      installationId: project.githubInstallationId,
      owner: project.owner,
      repo: project.name,
      branch: parsed.data.branch,
    });
    return Response.json({ pullRequest });
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
