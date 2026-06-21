import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import { getProjectByLocalPath } from "@/src/db/queries";
import type {
  ProjectEnvironmentSummary,
  ProjectEnvironmentVariableSummary,
} from "@/src/lib/api-types";

const execFileAsync = promisify(execFile);

const ENV_FILE_NAME = ".env";
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_ENV_VALUE_BYTES = 64 * 1024;
const RESERVED_ENV_KEYS = new Set(
  [
    "ANTON_LOCAL_WORKSPACES_ROOT",
    "CI",
    "COLORTERM",
    "COMSPEC",
    "DATABASE_URL",
    "FORCE_COLOR",
    "GH_CONFIG_DIR",
    "GH_HOST",
    "GH_NO_EXTENSION_UPDATE_NOTIFIER",
    "GH_NO_UPDATE_NOTIFIER",
    "GH_PROMPT_DISABLED",
    "GH_REPO",
    "GH_SPINNER_DISABLED",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "HOSTNAME",
    "LANG",
    "LC_ALL",
    "NO_COLOR",
    "NODE_ENV",
    "PATH",
    "PATHEXT",
    "PNPM_HOME",
    "PORT",
    "SHELL",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "WINDIR",
    "WORKSPACE_ROOT",
  ].map((key) => key.toUpperCase()),
);

export class ProjectEnvironmentError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProjectEnvironmentError";
    this.status = status;
  }
}

export type ProjectEnvPatch = {
  upsert?: readonly { key: string; value: string }[];
  delete?: readonly string[];
};

type ParsedEnvLine =
  | { kind: "entry"; key: string; value: string; line: string }
  | { kind: "other"; line: string };

export function validateProjectEnvKey(key: string): string {
  const trimmed = key.trim();
  if (!ENV_KEY_PATTERN.test(trimmed)) {
    throw new ProjectEnvironmentError(
      "Environment variable names must start with a letter or underscore and contain only letters, numbers, and underscores.",
    );
  }
  if (isReservedProjectEnvKey(trimmed)) {
    throw new ProjectEnvironmentError(
      `${trimmed} is reserved by Anton and cannot be managed as a project environment variable.`,
    );
  }
  return trimmed;
}

export function validateProjectEnvValue(value: string): string {
  const size = Buffer.byteLength(value, "utf8");
  if (size > MAX_ENV_VALUE_BYTES) {
    throw new ProjectEnvironmentError(
      `Environment variable values must be ${MAX_ENV_VALUE_BYTES} bytes or smaller.`,
    );
  }
  return value;
}

export async function summarizeProjectEnvironment(input: {
  projectId: string;
  root: string;
  enabled: boolean;
}): Promise<ProjectEnvironmentSummary> {
  const root = ensureWorkspaceRootAt(input.root);
  const entries = await readProjectEnvEntries(root);
  return {
    projectId: input.projectId,
    enabled: input.enabled,
    envFile: envFilePath(root),
    variables: summarizeVariables(entries),
  };
}

export async function patchProjectEnvironment(
  rootInput: string,
  patch: ProjectEnvPatch,
): Promise<void> {
  const root = ensureWorkspaceRootAt(rootInput);
  await assertEnvFileIsUntracked(root);
  await ensureEnvFileIgnored(root);

  const entries = await readProjectEnvLines(root);
  const upserts = new Map<string, string>();
  for (const item of patch.upsert ?? []) {
    upserts.set(
      validateProjectEnvKey(item.key),
      validateProjectEnvValue(item.value),
    );
  }
  const deletes = new Set((patch.delete ?? []).map(validateProjectEnvKey));

  const emitted = new Set<string>();
  const nextLines: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== "entry") {
      nextLines.push(entry.line);
      continue;
    }
    if (deletes.has(entry.key)) {
      continue;
    }
    if (upserts.has(entry.key)) {
      nextLines.push(formatEnvLine(entry.key, upserts.get(entry.key) ?? ""));
      emitted.add(entry.key);
      continue;
    }
    nextLines.push(entry.line);
  }

  for (const [key, value] of upserts) {
    if (emitted.has(key) || deletes.has(key)) continue;
    nextLines.push(formatEnvLine(key, value));
  }

  const content = nextLines.length === 0 ? "" : `${nextLines.join("\n")}\n`;
  const file = envFilePath(root);
  await fs.writeFile(file, content, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => null);
}

export function loadProjectEnvironmentForProcess(
  cwdInput: string,
): Record<string, string> {
  let root: string;
  try {
    root = ensureWorkspaceRootAt(cwdInput);
  } catch {
    return {};
  }
  const project = getProjectByLocalPath(root);
  if (!project?.environmentEnabled) return {};

  const file = envFilePath(root);
  if (!fsSync.existsSync(file)) return {};
  const content = fsSync.readFileSync(file, "utf8");
  return Object.fromEntries(
    parseProjectEnvContent(content)
      .filter((entry): entry is Extract<ParsedEnvLine, { kind: "entry" }> =>
        entry.kind === "entry" &&
        !isReservedProjectEnvKey(entry.key) &&
        Buffer.byteLength(entry.value, "utf8") <= MAX_ENV_VALUE_BYTES
      )
      .map((entry) => [entry.key, entry.value]),
  );
}

export function isReservedProjectEnvKey(key: string): boolean {
  const normalized = key.toUpperCase();
  return RESERVED_ENV_KEYS.has(normalized) || normalized.startsWith("LC_");
}

async function readProjectEnvEntries(
  root: string,
): Promise<Extract<ParsedEnvLine, { kind: "entry" }>[]> {
  return (await readProjectEnvLines(root)).filter(
    (entry): entry is Extract<ParsedEnvLine, { kind: "entry" }> =>
      entry.kind === "entry",
  );
}

async function readProjectEnvLines(root: string): Promise<ParsedEnvLine[]> {
  const file = envFilePath(root);
  const content = await fs.readFile(file, "utf8").catch((err: unknown) => {
    if (isNodeError(err) && err.code === "ENOENT") return "";
    throw err;
  });
  return parseProjectEnvContent(content);
}

function parseProjectEnvContent(content: string): ParsedEnvLine[] {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line, index, lines) => index < lines.length - 1 || line.length > 0)
    .map(parseEnvLine);
}

function parseEnvLine(line: string): ParsedEnvLine {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (!match) return { kind: "other", line };
  const key = match[1] ?? "";
  if (isReservedProjectEnvKey(key)) return { kind: "entry", key, value: "", line };
  return {
    kind: "entry",
    key,
    value: parseEnvValue(match[2] ?? ""),
    line,
  };
}

function parseEnvValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }
  return raw.replace(/\s+#.*$/, "").trim();
}

function summarizeVariables(
  entries: readonly Extract<ParsedEnvLine, { kind: "entry" }>[],
): ProjectEnvironmentVariableSummary[] {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (isReservedProjectEnvKey(entry.key)) continue;
    if (!ENV_KEY_PATTERN.test(entry.key)) continue;
    keys.add(entry.key);
  }
  return [...keys].sort((left, right) => left.localeCompare(right)).map((key) => ({
    key,
    type: "raw_secret",
  }));
}

async function assertEnvFileIsUntracked(root: string): Promise<void> {
  const result = await execFileAsync("git", ["ls-files", "--error-unmatch", "--", ENV_FILE_NAME], {
    cwd: root,
  }).then(
    () => true,
    () => false,
  );
  if (result) {
    throw new ProjectEnvironmentError(
      "Refusing to manage .env because it is tracked by git in this project.",
      409,
    );
  }
}

async function ensureEnvFileIgnored(root: string): Promise<void> {
  const gitPath = await execFileAsync("git", ["rev-parse", "--git-path", "info/exclude"], {
    cwd: root,
  }).then((result) => result.stdout.trim());
  const excludePath = path.isAbsolute(gitPath) ? gitPath : path.join(root, gitPath);
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  const current = await fs.readFile(excludePath, "utf8").catch((err: unknown) => {
    if (isNodeError(err) && err.code === "ENOENT") return "";
    throw err;
  });
  const lines = current.replace(/\r\n/g, "\n").split("\n");
  if (lines.some((line) => line.trim() === ENV_FILE_NAME)) return;
  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  await fs.appendFile(excludePath, `${prefix}${ENV_FILE_NAME}\n`, "utf8");
}

function formatEnvLine(key: string, value: string): string {
  return `${key}=${formatEnvValue(value)}`;
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]*$/.test(value)) return value;
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/"/g, "\\\"")}"`;
}

function envFilePath(root: string): string {
  return path.join(root, ENV_FILE_NAME);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
