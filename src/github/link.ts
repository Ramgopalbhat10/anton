import { eq } from "drizzle-orm";

import { db } from "@/src/db/client";
import { getProject, listGithubInstallations } from "@/src/db/queries";
import { projects } from "@/src/db/schema";
import {
  isGitHubPatConfigured,
  listInstallationRepositories,
  listTokenRepositories,
  type GitHubRepository,
} from "./app";

export function parseGitHubUrl(url: string): { owner: string; name: string } | null {
  const trimmed = url.trim();
  const httpsMatch = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
    trimmed,
  );
  const sshMatch = /^(?:ssh:\/\/git@github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
    trimmed,
  );
  const match = httpsMatch ?? sshMatch;
  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    name: match[2],
  };
}

export async function attemptLinkLocalProject(projectId: string): Promise<boolean> {
  const project = getProject(projectId);
  if (!project || project.cloneUrl === null) return false;

  const parsed = parseGitHubUrl(project.cloneUrl);
  if (!parsed) return false;

  const repoFullName = `${parsed.owner}/${parsed.name}`.toLowerCase();

  if (isGitHubPatConfigured()) {
    const repos = await listTokenRepositories();
    const matchedRepo = repos.find(
      (repo) => repo.full_name.toLowerCase() === repoFullName,
    );
    if (matchedRepo) {
      linkProjectToRepository(projectId, matchedRepo, null);
      return true;
    }
  }

  const installations = listGithubInstallations();
  for (const inst of installations) {
    try {
      const repos = await listInstallationRepositories(inst.installationId);
      const matchedRepo = repos.find(
        (r) => r.full_name.toLowerCase() === repoFullName,
      );
      if (matchedRepo) {
        linkProjectToRepository(projectId, matchedRepo, inst.installationId);
        return true;
      }
    } catch (err) {
      console.error(
        `Failed to fetch repos for installation ${inst.installationId}:`,
        err,
      );
    }
  }

  return false;
}

function linkProjectToRepository(
  projectId: string,
  repository: GitHubRepository,
  installationId: number | null,
): void {
  db.update(projects)
    .set({
      provider: "github",
      githubRepoId: repository.id,
      githubInstallationId: installationId,
      owner: repository.owner.login,
      name: repository.name,
      fullName: repository.full_name,
      defaultBranch: repository.default_branch,
      cloneUrl: repository.clone_url,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .run();
}
