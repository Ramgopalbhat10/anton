import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import { getProject } from "@/src/db/queries";
import { createGitHubAccessToken } from "@/src/github/app";
import type { ProjectBranchesSummary } from "@/src/lib/api-types";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type Ctx = { params: Promise<{ id: string }> };

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("switch"),
    branch: z.string().trim().min(1),
    kind: z.enum(["local", "remote"]).default("local"),
  }),
  z.object({
    action: z.literal("create"),
    branch: z.string().trim().min(1),
  }),
]);

export async function GET(req: Request, { params }: Ctx) {
  const project = await readyProject(params);
  if ("error" in project) return project.error;

  try {
    const refresh = new URL(req.url).searchParams.get("refresh") === "1";
    let refreshError: string | null = null;
    if (refresh) {
      try {
        await fetchOrigin(project.project, project.root);
      } catch (err) {
        refreshError = redactText(errorMessage(err));
      }
    }
    return Response.json({
      branches: await branchSummary(project.project.id, project.project.defaultBranch, project.root),
      refreshError,
    });
  } catch (err) {
    return Response.json(
      { error: redactText(errorMessage(err)) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const project = await readyProject(params);
  if ("error" in project) return project.error;

  const body = await req.json().catch(() => null);
  const parsed = mutationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const data = parsed.data;
    if (data.action === "create") {
      const branch = normalizeNewBranchName(data.branch);
      await assertValidBranchName(project.root, branch);
      await gitOutput(project.root, ["switch", "-c", branch]);
    } else if (data.kind === "remote") {
      const branch = normalizeRemoteBranchName(data.branch);
      const localName = branch.replace(/^origin\//, "");
      await assertValidBranchName(project.root, localName);
      await gitOutput(project.root, ["switch", "--track", branch]);
    } else {
      await assertValidBranchName(project.root, data.branch);
      await gitOutput(project.root, ["switch", data.branch]);
    }

    return Response.json({
      branches: await branchSummary(
        project.project.id,
        project.project.defaultBranch,
        project.root,
      ),
    });
  } catch (err) {
    return Response.json(
      { error: redactText(errorMessage(err)) },
      { status: 409 },
    );
  }
}

async function readyProject(params: Promise<{ id: string }>): Promise<
  | { project: NonNullable<ReturnType<typeof getProject>>; root: string }
  | { error: Response }
> {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return { error: Response.json({ error: "project not found" }, { status: 404 }) };
  }
  if (project.status !== "ready") {
    return { error: Response.json({ error: "project is not ready" }, { status: 400 }) };
  }
  return { project, root: ensureWorkspaceRootAt(project.localPath) };
}

async function branchSummary(
  projectId: string,
  defaultBranch: string,
  root: string,
): Promise<ProjectBranchesSummary> {
  const branchRefFormat = "%(refname:short)|%(committerdate:unix)";
  const [currentBranch, localRaw, remoteRaw] = await Promise.all([
    gitOutput(root, ["branch", "--show-current"]).catch(() => ""),
    gitOutput(root, ["for-each-ref", `--format=${branchRefFormat}`, "refs/heads"]),
    gitOutput(root, [
      "for-each-ref",
      `--format=${branchRefFormat}`,
      "refs/remotes/origin",
    ]).catch(() => ""),
  ]);
  const current = currentBranch.trim() || null;
  const localBranches = parseBranchRefs(localRaw);
  const localNames = new Set(localBranches.map((branch) => branch.name));
  const remoteBranches = parseBranchRefs(remoteRaw)
    .filter((branch) => branch.name !== "origin" && branch.name !== "origin/HEAD")
    .filter((branch) => !localNames.has(branch.name.replace(/^origin\//, "")));

  return {
    projectId,
    currentBranch: current,
    defaultBranch,
    branches: [
      ...localBranches.map((branch) => ({
        name: branch.name,
        kind: "local" as const,
        current: branch.name === current,
        lastCommitAt: branch.lastCommitAt,
      })),
      ...remoteBranches.map((branch) => ({
        name: branch.name,
        kind: "remote" as const,
        current: false,
        lastCommitAt: branch.lastCommitAt,
      })),
    ].sort(compareBranches(defaultBranch)),
  };
}

async function fetchOrigin(
  project: { provider: string; githubInstallationId: number | null },
  root: string,
): Promise<void> {
  const originUrl = await gitOutput(root, ["remote", "get-url", "origin"]).catch(() => "");
  if (!originUrl) return;
  const env = await gitAuthEnv(project);
  await gitOutput(root, ["fetch", "--prune", "origin"], env);
}

async function gitOutput(
  cwd: string,
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    env: extraEnv ? { ...process.env, ...extraEnv } : undefined,
  });
  return result.stdout.trim();
}

async function gitAuthEnv(project: {
  provider: string;
  githubInstallationId: number | null;
}): Promise<Record<string, string> | undefined> {
  if (project.provider !== "github") {
    return undefined;
  }
  const { token } = await createGitHubAccessToken(project.githubInstallationId);
  const auth = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${auth}`,
  };
}

async function assertValidBranchName(root: string, branch: string): Promise<void> {
  if (branch.startsWith("-") || /[\s\0-\x1f]/.test(branch)) {
    throw new Error(`invalid branch name: ${branch}`);
  }
  await gitOutput(root, ["check-ref-format", "--branch", branch]);
}

function normalizeNewBranchName(name: string): string {
  return name.includes("/") ? name : `codex/${name}`;
}

function normalizeRemoteBranchName(name: string): string {
  return name.startsWith("origin/") ? name : `origin/${name}`;
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseBranchRefs(value: string): { name: string; lastCommitAt: number | null }[] {
  return splitLines(value).map((line) => {
    const separator = line.lastIndexOf("|");
    if (separator === -1) {
      return { name: line, lastCommitAt: null };
    }
    const name = line.slice(0, separator).trim();
    const parsed = Number.parseInt(line.slice(separator + 1).trim(), 10);
    const lastCommitAt = Number.isFinite(parsed) ? parsed * 1000 : null;
    return { name, lastCommitAt };
  });
}

function compareBranches(defaultBranch: string) {
  return (
    left: ProjectBranchesSummary["branches"][number],
    right: ProjectBranchesSummary["branches"][number],
  ): number => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    if (left.name === defaultBranch) return -1;
    if (right.name === defaultBranch) return 1;
    if (left.kind !== right.kind) return left.kind === "local" ? -1 : 1;
    return left.name.localeCompare(right.name);
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
