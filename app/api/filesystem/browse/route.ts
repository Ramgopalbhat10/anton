import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

import type { FilesystemBrowseEntry, FilesystemBrowseResult } from "@/src/lib/api-types";
import { getLocalWorkspacesRoot } from "@/src/workspace/local";

export const runtime = "nodejs";

const MAX_ENTRIES = 500;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawPath = url.searchParams.get("path")?.trim() || "";

  try {
    if (!rawPath) {
      const browse: FilesystemBrowseResult = await listRoots();
      return Response.json({ browse });
    }

    const browse = await listDirectory(rawPath);
    return Response.json({ browse });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

async function listRoots(): Promise<FilesystemBrowseResult> {
  const entries: FilesystemBrowseEntry[] = [];
  const seen = new Set<string>();

  const push = (name: string, entryPath: string) => {
    const resolved = path.resolve(entryPath);
    const key = resolved.toLowerCase();
    if (seen.has(key)) return;
    if (!fsSync.existsSync(resolved)) return;
    try {
      if (!fsSync.statSync(resolved).isDirectory()) return;
    } catch {
      return;
    }
    seen.add(key);
    entries.push({ name, path: resolved });
  };

  const home = os.homedir();
  if (home) push("Home", home);

  const workspaceRoot = getLocalWorkspacesRoot().path;
  if (workspaceRoot) push("Workspaces", workspaceRoot);

  if (process.platform === "win32") {
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const drive = `${letter}:\\`;
      push(drive, drive);
    }
  } else {
    push("/", "/");
  }

  return {
    currentPath: null,
    parentPath: null,
    entries,
    truncated: false,
  };
}

async function listDirectory(inputPath: string): Promise<FilesystemBrowseResult> {
  const resolved = path.resolve(inputPath);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new Error("Path does not exist.");
  }
  if (!stat.isDirectory()) {
    throw new Error("Path must be a directory.");
  }

  let dirents;
  try {
    dirents = await fs.readdir(resolved, { withFileTypes: true });
  } catch {
    throw new Error("Unable to read directory.");
  }

  const entries: FilesystemBrowseEntry[] = [];
  let truncated = false;
  for (const dirent of dirents) {
    if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
    if (dirent.name === "." || dirent.name === "..") continue;

    const childPath = path.join(resolved, dirent.name);
    try {
      const childStat = await fs.stat(childPath);
      if (!childStat.isDirectory()) continue;
    } catch {
      continue;
    }

    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }

    entries.push({ name: dirent.name, path: childPath });
  }

  entries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  const parent = path.dirname(resolved);
  const parentPath = parent === resolved ? null : parent;

  return {
    currentPath: resolved,
    parentPath,
    entries,
    truncated,
  };
}
