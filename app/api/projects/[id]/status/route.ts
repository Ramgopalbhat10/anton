import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import { getLastRunForProject, getProject } from "@/src/db/queries";
import { serializeProject } from "@/src/lib/api-serializers";
import type { ProjectLastRunSummary, ProjectStatusSummary } from "@/src/lib/api-types";
import { redactText } from "@/src/lib/redaction";
import { buildProjectGitStatusSummary, listDirtyFiles } from "@/src/workspace/git-status";
import { inspectProjectAtPath } from "@/src/workspace/project-inspect";
import type { Run } from "@/src/db/schema";

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
    const [inspect, git, dirtyFiles] = await Promise.all([
      Promise.resolve(inspectProjectAtPath(root)),
      buildProjectGitStatusSummary(project, root),
      listDirtyFiles(root, 50),
    ]);
    const lastRun = serializeLastRun(getLastRunForProject(project.id));
    const status: ProjectStatusSummary = {
      project: serializeProject(project),
      packageManager: inspect.packageManager,
      scripts: inspect.scripts,
      keyDependencies: inspect.keyDependencies,
      noteworthyFiles: inspect.noteworthyFiles,
      git,
      dirtyFiles,
      lastRun,
    };
    return Response.json({ status });
  } catch (err) {
    return Response.json(
      { error: redactText(errorMessage(err)) },
      { status: 500 },
    );
  }
}

function serializeLastRun(run: Run | undefined): ProjectLastRunSummary | null {
  if (!run) return null;
  return {
    runId: run.id,
    sessionId: run.sessionId,
    status: run.status,
    model: run.model,
    startedAt: run.startedAt.getTime(),
    finishedAt: run.finishedAt?.getTime() ?? null,
    durationMs: run.durationMs ?? null,
    stepCount: run.stepCount ?? null,
    totalTokens: run.totalTokens ?? null,
    costUsd: run.costUsd ?? null,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
