import { z } from "zod";

import { getLocalWorkspacesRoot } from "@/src/workspace/local";
import { cloneGitHubRepository, CloneError } from "@/src/workspace/clone";
import {
  importLocalRepository,
  LocalImportError,
} from "@/src/workspace/import-local";
import { listProjects } from "@/src/db/queries";
import { listInstallationRepositories } from "@/src/github/app";
import { serializeProject } from "@/src/lib/api-serializers";

export const runtime = "nodejs";

const createSchema = z.union([
  z.object({
    source: z.literal("github").optional(),
    repositoryId: z.number().int().positive(),
    installationId: z.number().int().positive(),
  }),
  z.object({
    source: z.literal("local"),
    localPath: z.string().trim().min(1),
  }),
]);

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
    const data = parsed.data;
    if ("localPath" in data) {
      const project = await importLocalRepository({
        localPath: data.localPath,
      });
      return Response.json({ project: serializeProject(project) }, { status: 201 });
    }

    const repos = await listInstallationRepositories(data.installationId);
    const repository = repos.find((repo) => repo.id === data.repositoryId);
    if (!repository) {
      return Response.json({ error: "repository not found" }, { status: 404 });
    }

    const project = await cloneGitHubRepository({
      repository,
      installationId: data.installationId,
    });
    return Response.json({ project: serializeProject(project) }, { status: 201 });
  } catch (err) {
    const status =
      err instanceof CloneError || err instanceof LocalImportError ? 400 : 500;
    return Response.json({ error: errorMessage(err) }, { status });
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
