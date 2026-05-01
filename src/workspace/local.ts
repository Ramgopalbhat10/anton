import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from "@/src/db/queries";

export type WorkspaceRootStatus = {
  path: string | null;
  source: "database" | "env" | "default";
  exists: boolean;
};

const DEFAULT_WORKSPACES_DIR = path.join(os.homedir(), ".anton", "workspaces");

export function getLocalWorkspacesRoot(): WorkspaceRootStatus {
  const settings = getWorkspaceSettings();
  const fromDb = settings.localWorkspacesRoot?.trim();
  if (fromDb) {
    return { path: path.resolve(fromDb), source: "database", exists: exists(fromDb) };
  }

  const fromEnv = process.env.ANTON_LOCAL_WORKSPACES_ROOT?.trim();
  if (fromEnv) {
    return { path: path.resolve(fromEnv), source: "env", exists: exists(fromEnv) };
  }

  return {
    path: DEFAULT_WORKSPACES_DIR,
    source: "default",
    exists: exists(DEFAULT_WORKSPACES_DIR),
  };
}

export async function setLocalWorkspacesRoot(inputPath: string | null) {
  if (inputPath === null || inputPath.trim() === "") {
    return updateWorkspaceSettings({ localWorkspacesRoot: null });
  }
  const root = await validateAndPrepareLocalWorkspacesRoot(inputPath);
  return updateWorkspaceSettings({ localWorkspacesRoot: root });
}

export async function validateAndPrepareLocalWorkspacesRoot(
  inputPath: string,
): Promise<string> {
  const resolved = path.resolve(inputPath);
  if (!path.isAbsolute(inputPath)) {
    throw new WorkspaceRootError("Workspace root must be an absolute path.");
  }
  if (hasUnsafeSegment(resolved)) {
    throw new WorkspaceRootError(
      "Workspace root cannot be inside .git, node_modules, or build output.",
    );
  }

  const appRoot = path.resolve(process.cwd());
  if (isInside(resolved, appRoot)) {
    throw new WorkspaceRootError(
      "Workspace root cannot be inside the Anton source directory.",
    );
  }

  await fs.mkdir(resolved, { recursive: true });
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new WorkspaceRootError("Workspace root must be a directory.");
  }

  const probe = path.join(resolved, `.anton-write-test-${randomUUID()}`);
  await fs.writeFile(probe, "ok", "utf8");
  await fs.unlink(probe);
  return fsSync.realpathSync(resolved);
}

export async function checkoutPathForRepo(input: {
  root: string;
  owner: string;
  name: string;
  githubRepoId: number;
}): Promise<string> {
  const owner = safePathSegment(input.owner);
  const name = safePathSegment(input.name);
  const base = path.join(input.root, owner, name);
  if (!exists(base)) return base;

  const gitDir = path.join(base, ".git");
  if (exists(gitDir)) return base;
  return path.join(input.root, owner, `${name}-${input.githubRepoId}`);
}

export class WorkspaceRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceRootError";
  }
}

function exists(target: string): boolean {
  return fsSync.existsSync(path.resolve(target));
}

function hasUnsafeSegment(target: string): boolean {
  const parts = path.resolve(target).split(path.sep).map((part) => part.toLowerCase());
  return parts.some((part) =>
    [".git", "node_modules", ".next", "dist", "build"].includes(part),
  );
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function safePathSegment(segment: string): string {
  const cleaned = segment.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "repo";
}
