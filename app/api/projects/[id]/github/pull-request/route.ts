import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import { getProject } from "@/src/db/queries";
import { createPullRequestForBranch, findPullRequestForBranch } from "@/src/github/app";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const execFileAsync = promisify(execFile);

const querySchema = z.object({
  branch: z.string().trim().min(1),
});

const createSchema = z.object({
  branch: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  body: z.string().trim().optional(),
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

export async function POST(req: Request, { params }: Ctx) {
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
    return Response.json({ error: "project is not a ready GitHub repository" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  if (parsed.data.branch === project.defaultBranch) {
    return Response.json(
      { error: "cannot create a pull request from the default branch" },
      { status: 400 },
    );
  }

  try {
    const status = await localBranchStatus(ensureWorkspaceRootAt(project.localPath));
    if (status.branch !== parsed.data.branch) {
      return Response.json(
        { error: "pull request branch must match the current local branch" },
        { status: 409 },
      );
    }
    if (status.dirtyCount > 0) {
      return Response.json(
        { error: "commit or discard local changes before creating a pull request" },
        { status: 409 },
      );
    }
    if (!status.upstream?.startsWith("origin/")) {
      return Response.json(
        { error: "push this branch to origin before creating a pull request" },
        { status: 409 },
      );
    }
    if (status.upstreamAhead !== 0) {
      return Response.json(
        { error: "push local commits before creating a pull request" },
        { status: 409 },
      );
    }
    const pullRequest = await createPullRequestForBranch({
      installationId: project.githubInstallationId,
      owner: project.owner,
      repo: project.name,
      branch: parsed.data.branch,
      baseBranch: project.defaultBranch,
      title: parsed.data.title ?? titleFromBranch(parsed.data.branch),
      body: parsed.data.body ?? bodyFromBranch(parsed.data.branch),
    });
    return Response.json({ pullRequest });
  } catch (err) {
    return Response.json(
      { error: redactText(errorMessage(err)) },
      { status: 502 },
    );
  }
}

function titleFromBranch(branch: string): string {
  return branch
    .replace(/^codex\//, "")
    .replace(/^\d+-/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || branch;
}

function bodyFromBranch(branch: string): string | null {
  const issueNumber = /^codex\/(\d+)(?:-|$)/.exec(branch)?.[1];
  return issueNumber ? `Closes #${issueNumber}` : null;
}

async function localBranchStatus(root: string): Promise<{
  branch: string | null;
  dirtyCount: number;
  upstream: string | null;
  upstreamAhead: number | null;
}> {
  const [branch, status, upstream, upstreamAheadBehind] = await Promise.all([
    gitOutput(root, ["branch", "--show-current"]).catch(() => ""),
    gitOutput(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    gitOutput(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).catch(
      () => "",
    ),
    gitOutput(root, [
      "rev-list",
      "--left-right",
      "--count",
      "@{upstream}...HEAD",
    ]).catch(() => ""),
  ]);
  const upstreamCounts = parseAheadBehind(upstreamAheadBehind);
  return {
    branch: branch.trim() || null,
    dirtyCount: status.split("\0").filter(Boolean).length,
    upstream: upstream.trim() || null,
    upstreamAhead: upstreamCounts?.ahead ?? null,
  };
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
