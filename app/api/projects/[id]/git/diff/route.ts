import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import { getProject } from "@/src/db/queries";
import type {
  ProjectLocalDiffSummary,
  ProjectPullRequestFileSummary,
} from "@/src/lib/api-types";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;

type Ctx = { params: Promise<{ id: string }> };

type DirtyEntry = {
  filename: string;
  status: string;
  previousFilename: string | null;
  untracked: boolean;
};

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
    const summary: ProjectLocalDiffSummary = {
      projectId: project.id,
      files: await localDiffFiles(root),
    };
    return Response.json({ diff: summary });
  } catch (err) {
    return Response.json(
      { error: redactText(errorMessage(err)) },
      { status: 500 },
    );
  }
}

async function localDiffFiles(root: string): Promise<ProjectPullRequestFileSummary[]> {
  const status = await gitOutput(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const entries = parsePorcelainStatus(status);
  return Promise.all(entries.map((entry) => localDiffFile(root, entry)));
}

async function localDiffFile(
  root: string,
  entry: DirtyEntry,
): Promise<ProjectPullRequestFileSummary> {
  const patch = entry.untracked
    ? null
    : await gitOutput(root, [
        "diff",
        "--no-ext-diff",
        "--find-renames",
        "HEAD",
        "--",
        entry.filename,
      ]);
  const counts = patch ? countPatchChanges(patch) : { additions: 0, deletions: 0 };
  return {
    filename: entry.filename,
    status: entry.status,
    additions: counts.additions,
    deletions: counts.deletions,
    changes: counts.additions + counts.deletions,
    patch,
    previousFilename: entry.previousFilename,
  };
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  return result.stdout;
}

function parsePorcelainStatus(raw: string): DirtyEntry[] {
  const records = raw.split("\0").filter((record) => record.length > 0);
  const entries: DirtyEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.length < 4) continue;
    const code = record.slice(0, 2);
    const filename = record.slice(3);
    if (!filename) continue;

    const status = statusFromPorcelain(code);
    const renamed = code.includes("R") || code.includes("C");
    let previousFilename: string | null = null;
    if (renamed) {
      previousFilename = records[index + 1] ?? null;
      index += previousFilename ? 1 : 0;
    }

    entries.push({
      filename,
      status,
      previousFilename,
      untracked: code === "??",
    });
  }
  return entries;
}

function statusFromPorcelain(code: string): string {
  if (code === "??") return "added";
  if (code.includes("R")) return "renamed";
  if (code.includes("D")) return "removed";
  if (code.includes("A")) return "added";
  return "modified";
}

function countPatchChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
