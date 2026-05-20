import { createSign } from "node:crypto";
import { z } from "zod";

import type {
  ProjectPullRequestCheckSummary,
  ProjectPullRequestSummary,
} from "@/src/lib/api-types";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

const accountSchema = z.object({
  login: z.string(),
  type: z.string(),
});

const installationSchema = z.object({
  id: z.number().int(),
  account: accountSchema,
});

const installationTokenSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
});

const repositorySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
  default_branch: z.string().default("main"),
  clone_url: z.string().url(),
  html_url: z.string().url(),
  owner: accountSchema,
});

const repositoriesResponseSchema = z.object({
  repositories: z.array(repositorySchema),
});

const pullRequestSchema = z.object({
  number: z.number().int(),
  state: z.enum(["open", "closed"]),
  title: z.string(),
  html_url: z.string().url(),
  merged: z.boolean().default(false),
  user: accountSchema,
  head: z.object({
    ref: z.string(),
    sha: z.string(),
  }),
  base: z.object({
    ref: z.string(),
  }),
  additions: z.number().int().default(0),
  deletions: z.number().int().default(0),
  changed_files: z.number().int().default(0),
  commits: z.number().int().default(0),
  comments: z.number().int().default(0),
  review_comments: z.number().int().default(0),
  created_at: z.string(),
  updated_at: z.string(),
});

const pullRequestFileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  changes: z.number().int(),
  patch: z.string().nullable().optional(),
  previous_filename: z.string().nullable().optional(),
});

const combinedStatusSchema = z.object({
  state: z.enum(["error", "failure", "pending", "success"]),
  statuses: z.array(
    z.object({
      state: z.enum(["error", "failure", "pending", "success"]),
    }).passthrough(),
  ).default([]),
});

const checkRunSchema = z.object({
  name: z.string(),
  status: z.enum(["queued", "in_progress", "completed", "unknown"]).catch("unknown"),
  conclusion: z
    .enum([
      "success",
      "failure",
      "neutral",
      "cancelled",
      "skipped",
      "timed_out",
      "action_required",
    ])
    .nullable()
    .catch(null),
  html_url: z.string().url().nullable().optional(),
});

const checkRunsResponseSchema = z.object({
  total_count: z.number().int().default(0),
  check_runs: z.array(checkRunSchema).default([]),
});

export type GitHubRepository = z.infer<typeof repositorySchema>;
type GitHubPullRequest = z.infer<typeof pullRequestSchema>;
type GitHubPullRequestFile = z.infer<typeof pullRequestFileSchema>;
type GitHubCombinedStatus = z.infer<typeof combinedStatusSchema>;
type GitHubCheckRun = z.infer<typeof checkRunSchema>;

export function isGitHubConfigured(): boolean {
  return readGitHubAppConfig() !== null;
}

export function githubInstallUrl(): string {
  const config = requireGitHubAppConfig();
  return config.setupUrl;
}

export async function fetchInstallation(installationId: number) {
  const jwt = createAppJwt();
  const json = await githubFetch(`/app/installations/${installationId}`, {
    token: jwt,
  });
  return installationSchema.parse(json);
}

export async function listInstallationRepositories(
  installationId: number,
): Promise<GitHubRepository[]> {
  const token = await createInstallationToken(installationId);
  const json = await githubFetch("/installation/repositories?per_page=100", {
    token: token.token,
  });
  return repositoriesResponseSchema.parse(json).repositories;
}

export async function findInstallationRepository(input: {
  installationId: number;
  repositoryId: number;
}): Promise<GitHubRepository | undefined> {
  const repos = await listInstallationRepositories(input.installationId);
  return repos.find((repo) => repo.id === input.repositoryId);
}

export async function findPullRequestForBranch(input: {
  installationId: number;
  owner: string;
  repo: string;
  branch: string;
}): Promise<ProjectPullRequestSummary | null> {
  const token = await createInstallationToken(input.installationId);
  const searchParams = new URLSearchParams({
    state: "all",
    head: `${input.owner}:${input.branch}`,
    sort: "updated",
    direction: "desc",
    per_page: "5",
  });
  const matches = z.array(pullRequestSchema).parse(
    await githubFetch(
      `/repos/${repoPath(input.owner, input.repo)}/pulls?${searchParams}`,
      { token: token.token },
    ),
  );
  const match = matches[0];
  if (!match) return null;

  const [details, files, checks] = await Promise.all([
    fetchPullRequest({
      token: token.token,
      owner: input.owner,
      repo: input.repo,
      number: match.number,
    }),
    fetchPullRequestFiles({
      token: token.token,
      owner: input.owner,
      repo: input.repo,
      number: match.number,
    }),
    fetchPullRequestChecks({
      token: token.token,
      owner: input.owner,
      repo: input.repo,
      ref: match.head.sha,
    }),
  ]);

  return serializePullRequest(details, files, checks);
}

export async function createInstallationToken(installationId: number): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const jwt = createAppJwt();
  const json = await githubFetch(
    `/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      token: jwt,
    },
  );
  const parsed = installationTokenSchema.parse(json);
  return {
    token: parsed.token,
    expiresAt: new Date(parsed.expires_at),
  };
}

async function fetchPullRequest(input: {
  token: string;
  owner: string;
  repo: string;
  number: number;
}): Promise<GitHubPullRequest> {
  return pullRequestSchema.parse(
    await githubFetch(
      `/repos/${repoPath(input.owner, input.repo)}/pulls/${input.number}`,
      { token: input.token },
    ),
  );
}

async function fetchPullRequestFiles(input: {
  token: string;
  owner: string;
  repo: string;
  number: number;
}): Promise<GitHubPullRequestFile[]> {
  return z.array(pullRequestFileSchema).parse(
    await githubFetch(
      `/repos/${repoPath(input.owner, input.repo)}/pulls/${input.number}/files?per_page=100`,
      { token: input.token },
    ),
  );
}

async function fetchPullRequestChecks(input: {
  token: string;
  owner: string;
  repo: string;
  ref: string;
}): Promise<{
  status: GitHubCombinedStatus;
  checkRuns: GitHubCheckRun[];
}> {
  const [status, checkRuns] = await Promise.all([
    githubFetch(
      `/repos/${repoPath(input.owner, input.repo)}/commits/${encodeURIComponent(input.ref)}/status`,
      { token: input.token },
    ).then((json) => combinedStatusSchema.parse(json)),
    githubFetch(
      `/repos/${repoPath(input.owner, input.repo)}/commits/${encodeURIComponent(input.ref)}/check-runs?per_page=100`,
      { token: input.token },
    ).then((json) => checkRunsResponseSchema.parse(json)),
  ]);
  return { status, checkRuns: checkRuns.check_runs };
}

function serializePullRequest(
  pr: GitHubPullRequest,
  files: GitHubPullRequestFile[],
  checks: { status: GitHubCombinedStatus; checkRuns: GitHubCheckRun[] },
): ProjectPullRequestSummary {
  const checkSummary = summarizeChecks(checks);
  return {
    number: pr.number,
    state: pr.state,
    merged: pr.merged,
    title: pr.title,
    htmlUrl: pr.html_url,
    authorLogin: pr.user.login,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    commits: pr.commits,
    comments: pr.comments,
    reviewComments: pr.review_comments,
    files: files.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ?? null,
      previousFilename: file.previous_filename ?? null,
    })),
    checks: checkSummary,
    createdAt: Date.parse(pr.created_at),
    updatedAt: Date.parse(pr.updated_at),
  };
}

function summarizeChecks(input: {
  status: GitHubCombinedStatus;
  checkRuns: GitHubCheckRun[];
}): ProjectPullRequestSummary["checks"] {
  const statusContexts = input.status.statuses;
  const runs: ProjectPullRequestCheckSummary[] = input.checkRuns.map((run) => ({
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url ?? null,
  }));
  const total = statusContexts.length + runs.length;
  const failed =
    statusContexts.filter((status) => ["error", "failure"].includes(status.state)).length +
    runs.filter((run) =>
      ["failure", "cancelled", "timed_out", "action_required"].includes(
        run.conclusion ?? "",
      ),
    ).length;
  const pending =
    statusContexts.filter((status) => status.state === "pending").length +
    runs.filter((run) => run.status !== "completed").length;
  const passed =
    statusContexts.filter((status) => status.state === "success").length +
    runs.filter((run) =>
      ["success", "neutral", "skipped"].includes(run.conclusion ?? ""),
    ).length;
  const state =
    total === 0
      ? "unknown"
      : failed > 0 || input.status.state === "failure"
        ? "failure"
        : input.status.state === "error"
          ? "error"
          : pending > 0 || input.status.state === "pending"
            ? "pending"
            : "success";

  return { state, total, passed, failed, pending, runs };
}

function repoPath(owner: string, repo: string): string {
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function createAppJwt(): string {
  const config = requireGitHubAppConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 540,
    iss: config.appId,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(config.privateKey, "base64url");
  return `${signingInput}.${signature}`;
}

async function githubFetch(
  path: string,
  options: { method?: string; token: string },
): Promise<unknown> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${options.token}`,
      "x-github-api-version": API_VERSION,
      "user-agent": "anton-local-agent",
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new GitHubAppError(
      `GitHub API request failed (${res.status})${errorSuffix(json)}`,
    );
  }
  return json;
}

type GitHubAppConfig = {
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  setupUrl: string;
};

function requireGitHubAppConfig(): GitHubAppConfig {
  const config = readGitHubAppConfig();
  if (!config) {
    throw new GitHubAppError("GitHub App environment variables are not configured.");
  }
  return config;
}

function readGitHubAppConfig(): GitHubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  const privateKey = normalizePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY);
  const setupUrl = process.env.GITHUB_APP_SETUP_URL?.trim();
  if (!appId || !clientId || !clientSecret || !privateKey || !setupUrl) {
    return null;
  }
  return { appId, clientId, clientSecret, privateKey, setupUrl };
}

function normalizePrivateKey(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function errorSuffix(json: unknown): string {
  if (
    typeof json === "object" &&
    json !== null &&
    "message" in json &&
    typeof (json as { message: unknown }).message === "string"
  ) {
    return `: ${(json as { message: string }).message}`;
  }
  return "";
}

export class GitHubAppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAppError";
  }
}
