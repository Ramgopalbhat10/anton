import { getProject, updateGithubProjectMetadata } from "@/src/db/queries";
import { findInstallationRepository } from "@/src/github/app";
import { attemptLinkLocalProject } from "@/src/github/link";
import { serializeProject } from "@/src/lib/api-serializers";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  if (
    project.provider !== "github" ||
    project.githubRepoId === null ||
    project.githubInstallationId === null
  ) {
    if (project.cloneUrl) {
      const linked = await attemptLinkLocalProject(project.id);
      if (linked) {
        const updated = getProject(project.id);
        return Response.json({ project: serializeProject(updated!) });
      }
    }
    return Response.json(
      { error: "project is not backed by GitHub and could not be linked to any active GitHub installation" },
      { status: 400 },
    );
  }

  try {
    const repository = await findInstallationRepository({
      installationId: project.githubInstallationId,
      repositoryId: project.githubRepoId,
    });
    if (!repository) {
      return Response.json(
        { error: "repository not found in GitHub installation" },
        { status: 502 },
      );
    }

    const refreshed = updateGithubProjectMetadata({
      id: project.id,
      githubRepoId: repository.id,
      githubInstallationId: project.githubInstallationId,
      owner: repository.owner.login,
      name: repository.name,
      fullName: repository.full_name,
      defaultBranch: repository.default_branch,
      cloneUrl: repository.clone_url,
      status: "ready",
      lastError: null,
    });
    if (!refreshed) {
      return Response.json({ error: "project not found" }, { status: 404 });
    }
    return Response.json({ project: serializeProject(refreshed) });
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
