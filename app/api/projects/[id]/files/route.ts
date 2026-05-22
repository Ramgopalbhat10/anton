import fs from "node:fs/promises";
import path from "node:path";

import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import { getProject } from "@/src/db/queries";
import type { ProjectFileTreeSummary } from "@/src/lib/api-types";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

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
    const result = await listProjectFiles(root);
    const summary: ProjectFileTreeSummary = {
      projectId: project.id,
      ignoredDirectories: [...IGNORED_DIRECTORIES],
      ...result,
    };
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

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
