import { z } from "zod";

import { getLocalWorkspacesRoot } from "@/src/workspace/local";
import { cloneGitHubRepository, CloneError } from "@/src/workspace/clone";
import { listProjects } from "@/src/db/queries";
import { listInstallationRepositories } from "@/src/github/app";
import type { Project } from "@/src/db/schema";

export const runtime = "nodejs";

const createSchema = z.object({
  repositoryId: z.number().int().positive(),
  installationId: z.number().int().positive(),
});

export async function GET() {
  return Response.json({
    workspaceRoot: getLocalWorkspacesRoot(),
    projects: listProjects().map(serializeProject),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const repos = await listInstallationRepositories(parsed.data.installationId);
    const repository = repos.find((repo) => repo.id === parsed.data.repositoryId);
    if (!repository) {
      return Response.json({ error: "repository not found" }, { status: 404 });
    }

    const project = await cloneGitHubRepository({
      repository,
      installationId: parsed.data.installationId,
    });
    return Response.json({ project: serializeProject(project) }, { status: 201 });
  } catch (err) {
    const status = err instanceof CloneError ? 400 : 500;
    return Response.json({ error: errorMessage(err) }, { status });
  }
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

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
