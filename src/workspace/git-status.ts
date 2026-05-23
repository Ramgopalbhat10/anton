import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProjectGitStatusSummary } from "@/src/lib/api-types";
import { redactText } from "@/src/lib/redaction";
import { parseDirtyFilesFromPorcelain } from "@/src/workspace/project-inspect";

const execFileAsync = promisify(execFile);

export type ProjectGitStatusInput = {
  id: string;
  defaultBranch: string;
};

export async function buildProjectGitStatusSummary(
  project: ProjectGitStatusInput,
  root: string,
): Promise<ProjectGitStatusSummary> {
  const [branch, status, upstream, remoteUrl, aheadBehind, upstreamAheadBehind] =
    await Promise.all([
      gitOutput(root, ["branch", "--show-current"]).catch(() => ""),
      gitOutput(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      gitOutput(root, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ]).catch(() => ""),
      gitOutput(root, ["config", "--get", "remote.origin.url"]).catch(() => ""),
      gitOutput(root, [
        "rev-list",
        "--left-right",
        "--count",
        `origin/${project.defaultBranch}...HEAD`,
      ]).catch(() => ""),
      gitOutput(root, [
        "rev-list",
        "--left-right",
        "--count",
        "@{upstream}...HEAD",
      ]).catch(() => ""),
    ]);
  const counts = parseAheadBehind(aheadBehind);
  const upstreamCounts = parseAheadBehind(upstreamAheadBehind);
  const currentBranch = branch.trim() || null;
  const dirtyFiles = parseDirtyFilesFromPorcelain(status);

  return {
    projectId: project.id,
    branch: currentBranch,
    defaultBranch: project.defaultBranch,
    isDefaultBranch: currentBranch === project.defaultBranch,
    dirtyCount: dirtyFiles.length,
    ahead: counts?.ahead ?? null,
    behind: counts?.behind ?? null,
    upstreamAhead: upstreamCounts?.ahead ?? null,
    upstreamBehind: upstreamCounts?.behind ?? null,
    upstream: upstream.trim() || null,
    remoteUrl: remoteUrl.trim() ? redactText(remoteUrl.trim()) : null,
  };
}

export async function listDirtyFiles(
  root: string,
  limit = 50,
): Promise<string[]> {
  const status = await gitOutput(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return parseDirtyFilesFromPorcelain(status).slice(0, limit);
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
