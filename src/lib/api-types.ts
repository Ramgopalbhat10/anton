export type WorkspaceSettingsSummary = {
  localWorkspacesRoot: string | null;
  resolvedLocalWorkspacesRoot: string | null;
  source: "database" | "env" | "default";
  exists: boolean;
};

export type GitHubRepositorySummary = {
  id: number;
  installationId: number;
  accountLogin: string;
  accountType: string;
  name?: string;
  fullName: string;
  owner?: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl?: string;
  clonedProjectId: string | null;
  cloneStatus?: "cloning" | "ready" | "error" | null;
};

export type GitHubInstallationSummary = {
  installationId: number;
  accountLogin: string;
  accountType: string;
};

export type ProjectSummary = {
  id: string;
  provider: "github" | "local";
  githubRepoId: number | null;
  githubInstallationId: number | null;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string | null;
  localPath: string;
  status: "cloning" | "ready" | "error";
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ProjectGitStatusSummary = {
  projectId: string;
  branch: string | null;
  defaultBranch: string;
  isDefaultBranch: boolean;
  dirtyCount: number;
  ahead: number | null;
  behind: number | null;
  upstreamAhead: number | null;
  upstreamBehind: number | null;
  upstream: string | null;
  remoteUrl: string | null;
};

export type ProjectBranchSummary = {
  name: string;
  kind: "local" | "remote";
  current: boolean;
};

export type ProjectBranchesSummary = {
  projectId: string;
  currentBranch: string | null;
  defaultBranch: string;
  branches: ProjectBranchSummary[];
};

export type ProjectFileTreeSummary = {
  projectId: string;
  paths: string[];
  totalCount: number;
  truncated: boolean;
  ignoredDirectories: string[];
};

export type ProjectIssueSummary = {
  number: number;
  title: string;
  state: "open";
  htmlUrl: string;
  authorLogin: string;
  suggestedBranchName: string;
  updatedAt: number;
};

export type ProjectPullRequestFileSummary = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  previousFilename: string | null;
};

export type ProjectLocalDiffSummary = {
  projectId: string;
  files: ProjectPullRequestFileSummary[];
};

export type ProjectPullRequestCheckSummary = {
  id: number | null;
  workflowJobId: number | null;
  name: string;
  status: "queued" | "in_progress" | "completed" | "unknown";
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | null;
  htmlUrl: string | null;
  detailsUrl: string | null;
  canRerun: boolean;
};

export type ProjectPullRequestDiscussionItem = {
  id: number;
  kind: "comment" | "review_comment";
  inReplyToId: number | null;
  authorLogin: string;
  body: string;
  htmlUrl: string;
  path: string | null;
  line: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ProjectPullRequestCommitSummary = {
  sha: string;
  shortSha: string;
  title: string;
  message: string;
  htmlUrl: string;
  authorName: string;
  authorLogin: string | null;
  committedAt: number;
};

export type ProjectPullRequestListItem = {
  number: number;
  state: "open" | "closed";
  merged: boolean;
  title: string;
  htmlUrl: string;
  authorLogin: string;
  baseBranch: string;
  headBranch: string;
  updatedAt: number;
  createdAt: number;
};

export type ProjectPullRequestSummary = {
  number: number;
  state: "open" | "closed";
  merged: boolean;
  title: string;
  description: string | null;
  htmlUrl: string;
  authorLogin: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  comments: number;
  reviewComments: number;
  files: ProjectPullRequestFileSummary[];
  discussion: ProjectPullRequestDiscussionItem[];
  commitItems: ProjectPullRequestCommitSummary[];
  checks: {
    state: "unknown" | "pending" | "success" | "failure" | "error";
    total: number;
    passed: number;
    failed: number;
    pending: number;
    runs: ProjectPullRequestCheckSummary[];
  };
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

export type McpTransport = "stdio" | "http" | "sse";

// UI-facing MCP configs redact secret-looking env/header values as "[redacted]".
// PATCH requests may submit that sentinel to preserve the stored value.
export type StdioMcpConfig = {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
};

export type RemoteMcpConfig = {
  type: "http" | "sse";
  url: string;
  headers: Record<string, string>;
  redirect: "follow" | "error";
};

export type McpServerConfig = StdioMcpConfig | RemoteMcpConfig;

export type McpTrustSummary = {
  fingerprint: string;
  trusted: boolean;
  decision: "approved" | "denied" | null;
  approval: {
    title: string;
    summary: string;
    riskCategories: string[];
    details: string[];
    target: string;
  };
};

export type McpServerSummary = {
  id: string;
  displayName: string;
  namespace: string;
  transport: McpTransport;
  config: McpServerConfig;
  enabled: boolean;
  summary: string;
  trust: McpTrustSummary;
  lastStatus: "untested" | "ok" | "error";
  lastError: string | null;
  lastCheckedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type McpPreflightServer = Pick<
  McpServerSummary,
  "id" | "displayName" | "namespace" | "transport" | "summary" | "trust"
>;
