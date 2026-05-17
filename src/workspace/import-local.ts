import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import { createLocalProject } from "@/src/db/queries";

const execFileAsync = promisify(execFile);

export async function importLocalRepository(input: { localPath: string }) {
  const requestedPath = path.resolve(input.localPath);
  const stat = await fs.stat(requestedPath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new LocalImportError("Local project path must be an existing directory.");
  }

  const topLevel = await gitOutput(requestedPath, [
    "rev-parse",
    "--show-toplevel",
  ]).catch(() => null);
  if (!topLevel) {
    throw new LocalImportError("Local project path must be inside a Git repository.");
  }

  let localPath: string;
  try {
    localPath = ensureWorkspaceRootAt(topLevel);
  } catch (err) {
    throw new LocalImportError(errorMessage(err));
  }
  const name = path.basename(localPath);
  const owner = path.basename(path.dirname(localPath)) || "local";
  const defaultBranch =
    (await gitOutput(localPath, ["branch", "--show-current"]).catch(() => "")) ||
    "main";
  const cloneUrl =
    (await gitOutput(localPath, ["config", "--get", "remote.origin.url"]).catch(
      () => "",
    )) || null;

  return createLocalProject({
    owner,
    name,
    fullName: `${owner}/${name}`,
    defaultBranch,
    cloneUrl,
    localPath,
  });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd });
  return result.stdout.trim();
}

export class LocalImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalImportError";
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
