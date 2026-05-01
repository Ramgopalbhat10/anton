import { getProject } from "@/src/db/queries";
import type { Project } from "@/src/db/schema";

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

function serializeProject(project: Project) {
  return {
    id: project.id,
    provider: project.provider,
    githubRepoId: project.githubRepoId,
    githubInstallationId: project.githubInstallationId,
    owner: project.owner,
    name: project.name,
    fullName: project.fullName,
    defaultBranch: project.defaultBranch,
    cloneUrl: project.cloneUrl,
    localPath: project.localPath,
    status: project.status,
    lastError: project.lastError,
    createdAt: project.createdAt.getTime(),
    updatedAt: project.updatedAt.getTime(),
  };
}
