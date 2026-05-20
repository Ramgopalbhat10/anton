import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import { getProject } from "@/src/db/queries";
import type { ProjectGitStatusSummary } from "@/src/lib/api-types";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

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
    const [branch, status, upstream, remoteUrl, aheadBehind] = await Promise.all([
      gitOutput(root, ["branch", "--show-current"]).catch(() => ""),
      gitOutput(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      gitOutput(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).catch(
        () => "",
      ),
      gitOutput(root, ["config", "--get", "remote.origin.url"]).catch(() => ""),
      gitOutput(root, [
        "rev-list",
        "--left-right",
        "--count",
        `origin/${project.defaultBranch}...HEAD`,
      ]).catch(() => ""),
    ]);
    const counts = parseAheadBehind(aheadBehind);
    const currentBranch = branch.trim() || null;
    const summary: ProjectGitStatusSummary = {
      projectId: project.id,
      branch: currentBranch,
      defaultBranch: project.defaultBranch,
      isDefaultBranch: currentBranch === project.defaultBranch,
      dirtyCount: status.split("\0").filter(Boolean).length,
      ahead: counts?.ahead ?? null,
      behind: counts?.behind ?? null,
      upstream: upstream.trim() || null,
      remoteUrl: remoteUrl.trim() ? redactText(remoteUrl.trim()) : null,
    };
    return Response.json({ status: summary });
  } catch (err) {
    return Response.json(
      { error: redactText(errorMessage(err)) },
      { status: 500 },
    );
  }
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd });
  return result.stdout.trim();
}

function parseAheadBehind(value: string): { ahead: number; behind: number } | null {
  const [behindRaw, aheadRaw] = value.trim().split(/\s+/, 2);
  const behind = Number(behindRaw);
  const ahead = Number(aheadRaw);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null;
  return { ahead, behind };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
