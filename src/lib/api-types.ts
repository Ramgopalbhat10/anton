export type WorkspaceSettingsSummary = {
  localWorkspacesRoot: string | null;
  resolvedLocalWorkspacesRoot: string | null;
  source: "database" | "env" | "default";
  exists: boolean;
};

export type GitHubRepositorySummary = {
  id: number;
  installationId: number;
  name?: string;
  fullName: string;
  owner?: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl?: string;
  clonedProjectId: string | null;
  cloneStatus?: "cloning" | "ready" | "error" | null;
};

export type ProjectSummary = {
  id: string;
  provider: "github";
  githubRepoId: number;
  githubInstallationId: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string;
  localPath: string;
  status: "cloning" | "ready" | "error";
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ProjectMemory = {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type SkillSummary = {
  slug: string;
  name: string;
  description: string;
  path: string;
};

export type SkillDocument = SkillSummary & {
  body: string;
};
