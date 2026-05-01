import {
  listGithubInstallations,
  listProjects,
} from "@/src/db/queries";
import {
  isGitHubConfigured,
  listInstallationRepositories,
} from "@/src/github/app";

export const runtime = "nodejs";

export async function GET() {
  if (!isGitHubConfigured()) {
    return Response.json(
      { error: "GitHub App environment variables are not configured." },
      { status: 503 },
    );
  }

  try {
    const projects = listProjects();
    const projectByRepoId = new Map(
      projects.map((project) => [project.githubRepoId, project]),
    );
    const repositories = [];
    for (const installation of listGithubInstallations()) {
      const repos = await listInstallationRepositories(
        installation.installationId,
      );
      repositories.push(
        ...repos.map((repo) => {
          const project = projectByRepoId.get(repo.id);
          return {
            id: repo.id,
            installationId: installation.installationId,
            name: repo.name,
            fullName: repo.full_name,
            owner: repo.owner.login,
            private: repo.private,
            defaultBranch: repo.default_branch,
            htmlUrl: repo.html_url,
            clonedProjectId: project?.id ?? null,
            cloneStatus: project?.status ?? null,
          };
        }),
      );
    }
    return Response.json({ repositories });
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
