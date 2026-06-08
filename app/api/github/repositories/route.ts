import {
  listGithubInstallations,
  listProjects,
} from "@/src/db/queries";
import {
  getAuthenticatedGitHubUser,
  getGitHubAuthMode,
  isGitHubConfigured,
  listInstallationRepositories,
  listTokenRepositories,
} from "@/src/github/app";

export const runtime = "nodejs";

export async function GET() {
  if (!isGitHubConfigured()) {
    return Response.json(
      { error: "GitHub auth is not configured. Set GITHUB_TOKEN/GITHUB_PAT or configure the GitHub App." },
      { status: 503 },
    );
  }

  try {
    const projects = listProjects();
    const projectByRepoId = new Map(
      projects.map((project) => [project.githubRepoId, project]),
    );
    if (getGitHubAuthMode() === "pat") {
      const [account, repos] = await Promise.all([
        getAuthenticatedGitHubUser(),
        listTokenRepositories(),
      ]);
      return Response.json({
        installations: [
          {
            installationId: null,
            accountLogin: account.login,
            accountType: "Personal access token",
          },
        ],
        repositories: repos.map((repo) => {
          const project = projectByRepoId.get(repo.id);
          return {
            id: repo.id,
            installationId: null,
            accountLogin: account.login,
            accountType: "Personal access token",
            name: repo.name,
            fullName: repo.full_name,
            owner: repo.owner.login,
            private: repo.private,
            defaultBranch: repo.default_branch,
            htmlUrl: repo.html_url,
            clonedProjectId: project?.status === "ready" ? project.id : null,
            cloneStatus: project?.status ?? null,
            cloneError: project?.lastError ?? null,
          };
        }),
      });
    }

    const installations = listGithubInstallations();
    const repositories = [];
    for (const installation of installations) {
      const repos = await listInstallationRepositories(
        installation.installationId,
      );
      repositories.push(
        ...repos.map((repo) => {
          const project = projectByRepoId.get(repo.id);
          return {
            id: repo.id,
            installationId: installation.installationId,
            accountLogin: installation.accountLogin,
            accountType: installation.accountType,
            name: repo.name,
            fullName: repo.full_name,
            owner: repo.owner.login,
            private: repo.private,
            defaultBranch: repo.default_branch,
            htmlUrl: repo.html_url,
            clonedProjectId: project?.status === "ready" ? project.id : null,
            cloneStatus: project?.status ?? null,
            cloneError: project?.lastError ?? null,
          };
        }),
      );
    }
    return Response.json({
      installations: installations.map((installation) => ({
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
      })),
      repositories,
    });
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
