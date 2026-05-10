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
