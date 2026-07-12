import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import { createLocalProject, getProject } from "@/src/db/queries";
import { attemptLinkLocalProject } from "@/src/github/link";

const execFileAsync = promisify(execFile);

export async function importLocalRepository(input: { localPath: string }) {
  const requestedPath = path.resolve(input.localPath);
  const stat = await fs.stat(requestedPath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new LocalImportError("Local project path must be an existing directory.");
  }

  const gitTopLevel = await gitOutput(requestedPath, [
    "rev-parse",
    "--show-toplevel",
  ]).catch(() => null);

  const candidatePath = gitTopLevel || requestedPath;

  let localPath: string;
  try {
    localPath = ensureWorkspaceRootAt(candidatePath);
  } catch (err) {
    throw new LocalImportError(errorMessage(err));
  }

  const name = path.basename(localPath);
  const owner = path.basename(path.dirname(localPath)) || "local";

  let defaultBranch = "main";
  let cloneUrl: string | null = null;

  if (gitTopLevel) {
    defaultBranch =
      (await gitOutput(localPath, ["branch", "--show-current"]).catch(() => "")) ||
      "main";
    cloneUrl =
      (await gitOutput(localPath, ["config", "--get", "remote.origin.url"]).catch(
        () => "",
      )) || null;
  }

  const project = createLocalProject({
    owner,
    name,
    fullName: `${owner}/${name}`,
    defaultBranch,
    cloneUrl,
    localPath,
  });

  if (gitTopLevel) {
    await attemptLinkLocalProject(project.id).catch(() => null);
  }

  return getProject(project.id) || project;
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
