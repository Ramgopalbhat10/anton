import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import { getProject } from "@/src/db/queries";
import type {
  ProjectFileGitStatus,
  ProjectFileGitStatusEntry,
  ProjectFileTreeSummary,
} from "@/src/lib/api-types";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const MAX_FILE_TREE_ENTRIES = 8_000;
const IGNORED_DIRECTORIES = [
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
] as const;
const ignoredDirectorySet = new Set<string>(IGNORED_DIRECTORIES);

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
    const [result, gitStatusResult] = await Promise.all([
      listProjectFiles(root),
      listProjectGitStatus(root),
    ]);
    const summary: ProjectFileTreeSummary = {
      projectId: project.id,
      gitStatus: gitStatusResult.entries,
      ignoredDirectories: [...IGNORED_DIRECTORIES],
      ...result,
    };
    if (gitStatusResult.error) {
      console.error("[project files] git status unavailable:", gitStatusResult.error);
    }
    return Response.json({ fileTree: summary });
  } catch (err) {
    return Response.json(
      { error: redactText(errorMessage(err)) },
      { status: 500 },
    );
  }
}

async function listProjectFiles(root: string): Promise<{
  paths: string[];
  totalCount: number;
  truncated: boolean;
}> {
  const paths: string[] = [];
  let totalCount = 0;
  let truncated = false;

  async function walk(directory: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof readDirectoryEntries>>;
    try {
      entries = await readDirectoryEntries(directory);
    } catch {
      return;
    }

    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    for (const entry of entries) {
      if (truncated) return;
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (ignoredDirectorySet.has(entry.name)) continue;
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      totalCount += 1;
      if (paths.length >= MAX_FILE_TREE_ENTRIES) {
        truncated = true;
        return;
      }
      paths.push(path.relative(root, absolutePath).split(path.sep).join("/"));
    }
  }

  await walk(root);
  return { paths, totalCount, truncated };
}

function readDirectoryEntries(directory: string) {
  return fs.readdir(directory, { withFileTypes: true });
}

async function listProjectGitStatus(root: string): Promise<{
  entries: ProjectFileGitStatusEntry[];
  error: string | null;
}> {
  try {
    const output = await gitOutput(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    return { entries: parsePorcelainStatus(output), error: null };
  } catch (err) {
    return { entries: [], error: errorMessage(err) };
  }
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd });
  return result.stdout;
}

function parsePorcelainStatus(output: string): ProjectFileGitStatusEntry[] {
  const tokens = output.split("\0").filter(Boolean);
  const entries: ProjectFileGitStatusEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.length < 4) continue;
    const indexStatus = token[0] ?? " ";
    const worktreeStatus = token[1] ?? " ";
    const statusPath = token.slice(3);
    const status = toProjectFileGitStatus(indexStatus, worktreeStatus);
    if (!status) continue;
    if (indexStatus === "R" || indexStatus === "C") index += 1;
    entries.push({
      path: statusPath.split(path.sep).join("/"),
      status,
    });
  }
  return entries;
}

function toProjectFileGitStatus(
  indexStatus: string,
  worktreeStatus: string,
): ProjectFileGitStatus | null {
  if (indexStatus === "R") return "renamed";
  if (indexStatus === "A" || worktreeStatus === "A") return "added";
  if (indexStatus === "D" || worktreeStatus === "D") return "deleted";
  if (indexStatus === "?" || worktreeStatus === "?") return "untracked";
  if (indexStatus === "!" || worktreeStatus === "!") return "ignored";
  if (indexStatus === "M" || worktreeStatus === "M") return "modified";
  return null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
