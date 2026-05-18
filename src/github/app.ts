import { createSign } from "node:crypto";
import { z } from "zod";

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

export type GitHubRepository = z.infer<typeof repositorySchema>;

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
