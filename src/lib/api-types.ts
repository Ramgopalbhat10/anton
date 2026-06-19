export type WorkspaceSettingsSummary = {
  localWorkspacesRoot: string | null;
  resolvedLocalWorkspacesRoot: string | null;
  source: "database" | "env" | "default";
  exists: boolean;
  defaultModel: string | null;
  defaultPermissionMode: "default" | "auto-review" | "full-access" | null;
  openRouterRoutingPreferences: OpenRouterRoutingPreferences;
};

export type OpenRouterRoutingPreference = {
  order: string[];
  allowFallbacks: boolean;
};

export type OpenRouterRoutingPreferences = Record<
  string,
  OpenRouterRoutingPreference
>;

export type OpenRouterProviderSummary = {
  slug: string;
  name: string;
  headquarters: string | null;
  datacenters: string[];
  privacyPolicyUrl: string | null;
  termsOfServiceUrl: string | null;
  statusPageUrl: string | null;
};

export type OpenRouterModelSummary = {
  id: string;
  name: string;
  contextLength: number | null;
  promptPrice: string | null;
  completionPrice: string | null;
  detailsPath: string | null;
};

export type OpenRouterCatalogSummary = {
  providers: OpenRouterProviderSummary[];
  models: OpenRouterModelSummary[];
  source: "api" | "fallback";
  fetchedAt: number;
  error: string | null;
};

export type OpenCodeGoModelSummary = {
  id: string;
  name: string;
  created: number | null;
  ownedBy: string | null;
  contextLength: number | null;
  promptPrice: string | null;
  completionPrice: string | null;
};

export type OpenCodeGoCatalogSummary = {
  models: OpenCodeGoModelSummary[];
  source: "api" | "fallback";
  fetchedAt: number;
  error: string | null;
};

export type OpenRouterModelEndpointSummary = {
  tag: string;
  providerName: string;
  name: string;
  status: number | null;
  uptimeLast30m: number | null;
  latencyLast30m: number | null;
  supportsImplicitCaching: boolean;
  promptPrice: string | null;
  completionPrice: string | null;
  cacheReadPrice: string | null;
  cacheWritePrice: string | null;
};

export type OpenRouterModelEndpointsSummary = {
  model: string;
  endpoints: OpenRouterModelEndpointSummary[];
  source: "api" | "fallback";
  fetchedAt: number;
  error: string | null;
};

export type GitHubRepositorySummary = {
  id: number;
  installationId: number | null;
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
  cloneError?: string | null;
};

export type GitHubInstallationSummary = {
  installationId: number | null;
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

export type ProjectStatusSummary = {
  project: ProjectSummary;
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | null;
  scripts: string[];
  keyDependencies: string[];
  noteworthyFiles: string[];
  git: ProjectGitStatusSummary;
  dirtyFiles: string[];
  lastRun: ProjectLastRunSummary | null;
};

export type ProjectLastRunSummary = {
  runId: string;
  sessionId: string;
  status: "running" | "completed" | "error" | "aborted";
  model: string;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  stepCount: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  finishReason: string | null;
};

export type ProjectRunDetailsContextComposition = {
  systemPromptTokens: number;
  toolDefinitionsTokens: number;
  memoryTokens: number;
  skillsTokens: number;
  mcpPromptTokens: number;
  runProfileTokens: number;
  priorRunContextTokens: number;
  conversationTokens: number;
  source: "estimated";
};

export type ProjectRunDetailsStepUsage = {
  stepNumber: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  toolCallCount?: number;
  finishReason?: string;
};

export type ProjectRunDetailsPromptCache = {
  modelId: string;
  providerId: string;
  routingFingerprint?: string;
  systemPromptHash: string;
  toolSchemaHash: string;
  nativeToolNamesHash: string;
  mcpToolNamesHash: string;
  workspaceContextHash: string;
  messagePrefixHash: string;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  cacheHitRate?: number;
  intentionalSegmentTransition?: string;
  likelyCacheMissReasons: string[];
  cacheBreakReasons: string[];
};

export type ProjectRunDetailsTokenUsage = {
  rawInputTokens?: number;
  uncachedInputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  effectiveInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  effectiveTokens?: number;
  providerEffectiveTokens?: number;
};

export type ProjectRunDetailsRun = {
  id: string;
  sessionId: string;
  status: "running" | "completed" | "error" | "aborted";
  model: string;
  provider: string | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  stepCount: number | null;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  tokenUsage?: ProjectRunDetailsTokenUsage;
  contextComposition?: ProjectRunDetailsContextComposition;
  stepUsage?: ProjectRunDetailsStepUsage[];
  promptCache?: ProjectRunDetailsPromptCache;
  profile?: string | null;
  mode?: string | null;
  tokenBudgetMultiplier?: number | null;
  cacheHitRate?: number | null;
  loopGuardCount?: number | null;
  verificationSummary?: string | null;
  profileHandoffRequired?: boolean | null;
  handoffFromProfile?: string | null;
  handoffToProfile?: string | null;
  handoffReason?: string | null;
  rawTotalTokens?: number | null;
  effectiveTokens?: number | null;
  openRouterRouting?: {
    source: "settings" | "env" | "builtin" | "default";
    modelId: string;
    order: string[];
    allowFallbacks: boolean;
    requireParameters: boolean;
    fingerprint: string;
  };
};

export type ProjectRunDetailsEvent = {
  id: string;
  sequence: number;
  kind: "step" | "reasoning" | "tool" | "approval" | "error" | "progress";
  status: "running" | "completed" | "waiting" | "error" | "denied";
  label: string;
  summary: string | null;
  startedAt: number;
  durationMs: number | null;
  toolCallId: string | null;
};

export type ProjectRunDetailsToolCall = {
  id: string;
  toolCallId: string;
  toolName: string;
  stepNumber: number | null;
  status: "running" | "completed" | "error" | "denied";
  approvalDecision: "pending" | "approved" | "denied" | null;
  permissionLabel: string | null;
  inputSummary: string | null;
  outputSummary: string | null;
  exitCode: number | null;
  error: string | null;
  durationMs: number | null;
};

export type ProjectRunDetailsApproval = {
  toolCallId: string;
  decision: "pending" | "approved" | "denied";
  title: string;
  summary: string;
  riskCategories: string[];
  requestedAt: number;
  respondedAt: number | null;
};

export type ProjectRunDetailsContextCommand = {
  command: string;
  exitCode: number | null;
  ok: boolean;
  timedOut: boolean;
  error?: string;
};

export type ProjectRunDetailsContextFile = {
  path: string;
  action: string;
};

export type ProjectRunDetailsContextTool = {
  name: string;
  status: "completed" | "error";
  input?: string;
  output?: string;
  exitCode?: number | null;
  error?: string;
};

export type ProjectRunDetailsContext = {
  summary: string;
  facts: string[];
  files: ProjectRunDetailsContextFile[];
  commands: ProjectRunDetailsContextCommand[];
  tools: ProjectRunDetailsContextTool[];
} | null;

export type ProjectRunDetailsSummary = {
  run: ProjectRunDetailsRun;
  events: ProjectRunDetailsEvent[];
  toolCalls: ProjectRunDetailsToolCall[];
  approvals: ProjectRunDetailsApproval[];
  context: ProjectRunDetailsContext;
  segmentCount?: number;
};

export type ProjectBranchSummary = {
  name: string;
  kind: "local" | "remote";
  current: boolean;
  lastCommitAt: number | null;
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
  directories: string[];
  gitStatus: ProjectFileGitStatusEntry[];
  totalCount: number;
  truncated: boolean;
  ignoredDirectories: string[];
};

export type ProjectFileGitStatus =
  | "added"
  | "deleted"
  | "ignored"
  | "modified"
  | "renamed"
  | "untracked";

export type ProjectFileGitStatusEntry = {
  path: string;
  status: ProjectFileGitStatus;
};

export type ProjectFileContentSummary = {
  projectId: string;
  path: string;
  content: string;
  sizeBytes: number;
  sha256: string;
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

export type BackgroundCommandStatus =
  | "starting"
  | "running"
  | "stopping"
  | "exited"
  | "failed"
  | "stopped"
  | "stale";

export type BackgroundCommandKind = "script" | "custom";

export type BackgroundCommandSessionSummary = {
  id: string;
  projectId: string;
  command: string;
  commandKind: BackgroundCommandKind;
  status: BackgroundCommandStatus;
  pid: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  stdoutTail: string;
  stderrTail: string;
  detectedUrls: string[];
  createdAt: number;
  updatedAt: number;
};

export type ProjectBackgroundCommandsSummary = {
  running: BackgroundCommandSessionSummary[];
  recent: BackgroundCommandSessionSummary[];
  runningCount: number;
};

export type BackgroundCommandPreflightResult = {
  allowed: boolean;
  risky: boolean;
  categories: string[];
  commandPolicyMode: "enforced" | "advisory";
  reason: string;
};

export type SkillSummary = {
  slug: string;
  name: string;
  description: string;
  path: string;
  updatedAt: string;
};

export type SkillDocument = SkillSummary & {
  body: string;
};

export type ComposerSkillSummary = {
  source: "local" | "global";
  slug: string;
  name: string;
  description: string;
  command: string;
  path: string;
  updatedAt: string;
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
