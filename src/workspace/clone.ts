import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

import { createGitHubAccessToken, type GitHubRepository } from "@/src/github/app";
import { redactText } from "@/src/lib/redaction";
import {
  getProjectByGithubRepoId,
  upsertProject,
  updateProjectStatus,
} from "@/src/db/queries";
import { checkoutPathForRepo, getLocalWorkspacesRoot } from "./local";

export async function cloneGitHubRepository(input: {
  repository: GitHubRepository;
  installationId: number | null;
}) {
  const root = getLocalWorkspacesRoot();
  if (!root.path) {
    throw new CloneError("Local workspace root is not configured.");
  }

  await fs.mkdir(root.path, { recursive: true });
  const localPath = await checkoutPathForRepo({
    root: root.path,
    owner: input.repository.owner.login,
    name: input.repository.name,
    githubRepoId: input.repository.id,
  });

  const existing = getProjectByGithubRepoId(input.repository.id);
  if (existing?.status === "ready") return existing;

  const project = upsertProject({
    githubRepoId: input.repository.id,
    githubInstallationId: input.installationId,
    owner: input.repository.owner.login,
    name: input.repository.name,
    fullName: input.repository.full_name,
    defaultBranch: input.repository.default_branch,
    cloneUrl: input.repository.clone_url,
    localPath,
    status: "cloning",
    lastError: null,
  });

  try {
    await cloneOrFetch({
      cloneUrl: input.repository.clone_url,
      localPath,
      installationId: input.installationId,
    });
    return updateProjectStatus(project.id, "ready", null) ?? project;
  } catch (err) {
    const message = redactText(err instanceof Error ? err.message : String(err));
    updateProjectStatus(project.id, "error", message);
    throw new CloneError(message);
  }
}

async function cloneOrFetch(input: {
  cloneUrl: string;
  localPath: string;
  installationId: number | null;
}): Promise<void> {
  const gitDir = path.join(input.localPath, ".git");
  const { token } = await createGitHubAccessToken(input.installationId);
  const auth = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  const gitEnv = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}`,
  };

  if (await exists(gitDir)) {
    await execa("git", ["fetch", "--prune", "origin"], {
      cwd: input.localPath,
      env: gitEnv,
      reject: true,
    });
    await execa("git", ["remote", "set-url", "origin", input.cloneUrl], {
      cwd: input.localPath,
      reject: true,
    });
    return;
  }

  await fs.mkdir(path.dirname(input.localPath), { recursive: true });
  await execa("git", ["clone", input.cloneUrl, input.localPath], {
    env: gitEnv,
    reject: true,
  });
  await execa("git", ["remote", "set-url", "origin", input.cloneUrl], {
    cwd: input.localPath,
    reject: true,
  });
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

export class CloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloneError";
  }
}
