import type { ToolSet } from "ai";
import fs from "node:fs";

import {
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
  resolveInWorkspace,
} from "./sandbox";

// Permission gate helpers for tool execution.
//
// Permission modes:
// - "default": all native tools require user approval (most conservative).
// - "auto-review": read-only native tools auto-run, classified risky tools require approval (default).
// - "full-access": no native tools require approval.
//
// `needsApproval: true` causes `streamText` to emit a `tool-approval-request`
// part; the client UI then approves or denies via `addToolApprovalResponse`
// and the harness resumes the loop.

export type PermissionMode = "default" | "auto-review" | "full-access";

export const TOOL_RISK_CATEGORIES = [
  "read-only",
  "write",
  "delete",
  "network",
  "package-install",
  "git",
  "long-running-process",
  "external-integration",
] as const;

export type ToolRiskCategory = (typeof TOOL_RISK_CATEGORIES)[number];

export type ToolPermissionMetadata = {
  categories: readonly ToolRiskCategory[];
  requiresApproval: boolean;
  summary: string;
};

export type BashCommandClassification = {
  categories: readonly ToolRiskCategory[];
  forbidden: boolean;
  reason: string;
};

export type ToolApprovalMetadata = {
  title: string;
  summary: string;
  riskCategories: readonly ToolRiskCategory[];
  details: readonly string[];
  target?: string;
  command?: {
    command: string;
    shell: "bash -lc";
    cwd: string;
    timeoutMs: number;
    outputCapBytes: number;
    classification: BashCommandClassification;
  };
  external?: {
    serverName: string;
    toolName: string;
    sandboxedByAnton: boolean;
  };
};

const BASH_DEFAULT_TIMEOUT_MS = 30_000;
const BASH_OUTPUT_CAP_BYTES = 64 * 1024;
const WRITE_FILE_MAX_BYTES = 1024 * 1024;
const READ_FILE_MAX_BYTES = 256 * 1024;

const READ_ONLY = toolMetadata(
  ["read-only"],
  false,
  "Reads workspace or project context without changing state.",
);

export const NATIVE_TOOL_PERMISSION_METADATA = {
  read_file: READ_ONLY,
  grep: READ_ONLY,
  glob: READ_ONLY,
  write_file: toolMetadata(
    ["write"],
    true,
    "Writes or replaces a workspace file.",
  ),
  bash: toolMetadata(
    [
      "write",
      "delete",
      "network",
      "package-install",
      "git",
      "long-running-process",
      "external-integration",
    ],
    true,
    "Runs a shell command with command-specific risk classification.",
  ),
  list_memory: READ_ONLY,
  remember: toolMetadata(
    ["write"],
    true,
    "Creates a durable project memory.",
  ),
  update_memory: toolMetadata(
    ["write"],
    true,
    "Updates a durable project memory.",
  ),
  forget_memory: toolMetadata(
    ["delete"],
    true,
    "Deletes a durable project memory.",
  ),
  list_skills: READ_ONLY,
  read_skill: READ_ONLY,
  delegate_task: READ_ONLY,
} as const satisfies Record<string, ToolPermissionMetadata>;

export function getNativeToolPermissionMetadata(
  name: string,
): ToolPermissionMetadata | undefined {
  return NATIVE_TOOL_PERMISSION_METADATA[
    name as keyof typeof NATIVE_TOOL_PERMISSION_METADATA
  ];
}

export function buildToolApprovalMetadata({
  toolName,
  input,
  workspaceRoot,
}: {
  toolName: string;
  input: unknown;
  workspaceRoot?: string;
}): ToolApprovalMetadata | undefined {
  const nativeMetadata = getNativeToolPermissionMetadata(toolName);
  if (nativeMetadata) {
    return buildNativeToolApprovalMetadata(toolName, input, workspaceRoot);
  }

  if (isMcpTool(toolName)) {
    return buildMcpToolApprovalMetadata(toolName);
  }

  return undefined;
}

type ToolWithApproval = ToolSet[string] & {
  needsApproval?: boolean;
};

export function applyNativeToolPermissionPolicy<TTools extends ToolSet>(
  tools: TTools,
  mode: PermissionMode = "auto-review",
): TTools {
  return Object.fromEntries(
    Object.entries(tools).map(([name, toolValue]) => {
      const metadata = getNativeToolPermissionMetadata(name);
      if (!metadata) {
        throw new Error(`missing native tool permission policy: ${name}`);
      }

      const toolWithoutApproval: ToolWithApproval = {
        ...(toolValue as ToolWithApproval),
      };
      delete toolWithoutApproval.needsApproval;

      if (mode === "full-access") {
        return [name, toolWithoutApproval];
      }

      if (mode === "default") {
        return [name, { ...toolWithoutApproval, needsApproval: true }];
      }

      if (metadata.requiresApproval) {
        return [name, { ...toolWithoutApproval, needsApproval: true }];
      }

      return [name, toolWithoutApproval];
    }),
  ) as TTools;
}

export function stripApprovalFlags<TTools extends ToolSet>(
  tools: TTools,
): TTools {
  return Object.fromEntries(
    Object.entries(tools).map(([name, toolValue]) => {
      const stripped: ToolWithApproval = { ...(toolValue as ToolWithApproval) };
      delete stripped.needsApproval;
      return [name, stripped];
    }),
  ) as TTools;
}

export function preClassifyBashInput(
  input: unknown,
): BashCommandClassification | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const command = (input as Record<string, unknown>)["command"];
  if (typeof command !== "string") return undefined;
  return classifyBashCommand(command);
}

export function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__");
}

function buildNativeToolApprovalMetadata(
  toolName: string,
  input: unknown,
  workspaceRoot: string | undefined,
): ToolApprovalMetadata | undefined {
  const metadata = getNativeToolPermissionMetadata(toolName);
  if (!metadata) return undefined;
  const record = isRecord(input) ? input : {};

  switch (toolName) {
    case "bash":
      return buildBashApproval(record, metadata, workspaceRoot);
    case "write_file":
      return buildWriteFileApproval(record, metadata, workspaceRoot);
    case "read_file":
      return {
        title: "Read workspace file",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        target: stringValue(record.path),
        details: [
          pathDetail(record.path, workspaceRoot),
          lineRangeDetail(record.startLine, record.endLine),
          `Reads UTF-8 text only, capped at ${READ_FILE_MAX_BYTES} bytes.`,
        ],
      };
    case "grep":
      return {
        title: "Search workspace files",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        target: stringValue(record.path) ?? "workspace root",
        details: [
          `Pattern: ${stringValue(record.pattern) ?? "(missing)"}`,
          `Target: ${stringValue(record.path) ?? "workspace root"}`,
          `Glob filter: ${stringValue(record.glob) ?? "none"}`,
          `Case insensitive: ${booleanValue(record.caseInsensitive) ? "yes" : "no"}`,
        ],
      };
    case "glob":
      return {
        title: "List workspace files",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        target: stringValue(record.path) ?? "workspace root",
        details: [
          `Pattern: ${stringValue(record.pattern) ?? "(missing)"}`,
          `Base path: ${stringValue(record.path) ?? "workspace root"}`,
          "Lists matching file paths without reading file contents.",
        ],
      };
    case "remember":
      return {
        title: "Create project memory",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        details: [
          "Creates one durable project memory stored in Anton's SQLite database.",
          `Content length: ${stringValue(record.content)?.length ?? 0} characters.`,
        ],
      };
    case "update_memory":
      return {
        title: "Update project memory",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        target: stringValue(record.id),
        details: [
          `Memory ID: ${stringValue(record.id) ?? "(missing)"}`,
          "Replaces the memory content in Anton's SQLite database.",
          `Replacement length: ${stringValue(record.content)?.length ?? 0} characters.`,
        ],
      };
    case "forget_memory":
      return {
        title: "Delete project memory",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        target: stringValue(record.id),
        details: [
          `Memory ID: ${stringValue(record.id) ?? "(missing)"}`,
          "Deletes the durable project memory from Anton's SQLite database.",
        ],
      };
    case "list_memory":
      return {
        title: "List project memories",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        details: [
          `Limit: ${numberValue(record.limit) ?? "default"}`,
          "Reads durable project memories from Anton's SQLite database.",
        ],
      };
    case "list_skills":
      return {
        title: "List workspace skills",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        details: ["Lists skills under skills/<slug>/SKILL.md in the active workspace."],
      };
    case "read_skill":
      return {
        title: "Read workspace skill",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        target: stringValue(record.slug),
        details: [
          `Skill slug: ${stringValue(record.slug) ?? "(missing)"}`,
          "Reads skills/<slug>/SKILL.md from the active workspace.",
        ],
      };
    case "delegate_task":
      return {
        title: "Delegate read-only investigation",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        details: [
          "Starts a bounded child Anton agent with read/search/skills/memory access only.",
          "The delegate cannot write files, run shell commands, or mutate memory.",
        ],
      };
    default:
      return {
        title: toolName,
        summary: metadata.summary,
        riskCategories: metadata.categories,
        details: ["Runs this native Anton tool with the shown input."],
      };
  }
}

function buildBashApproval(
  input: Record<string, unknown>,
  metadata: ToolPermissionMetadata,
  workspaceRoot: string | undefined,
): ToolApprovalMetadata {
  const command = stringValue(input.command) ?? "";
  const timeoutMs = numberValue(input.timeoutMs) ?? BASH_DEFAULT_TIMEOUT_MS;
  const cwd = workspaceRootLabel(workspaceRoot);
  const classification = classifyBashCommand(command);

  return {
    title: "Run shell command",
    summary: metadata.summary,
    riskCategories: classification.categories,
    target: command,
    command: {
      command,
      shell: "bash -lc",
      cwd,
      timeoutMs,
      outputCapBytes: BASH_OUTPUT_CAP_BYTES,
      classification,
    },
    details: [
      `Command: ${command || "(empty)"}`,
      `Shell: bash -lc`,
      `Working directory: ${cwd}`,
      `Timeout: ${timeoutMs}ms`,
      `Output cap: ${BASH_OUTPUT_CAP_BYTES} bytes per stream.`,
      `Classification: ${classification.reason}.`,
      classification.forbidden
        ? "This command matches a forbidden pattern and will be refused even if approved."
        : "Approval lets the command start; it does not bypass sandbox cwd, timeout, or output limits.",
    ],
  };
}

function buildWriteFileApproval(
  input: Record<string, unknown>,
  metadata: ToolPermissionMetadata,
  workspaceRoot: string | undefined,
): ToolApprovalMetadata {
  const relPath = stringValue(input.path);
  const content = stringValue(input.content) ?? "";
  const byteLength = Buffer.byteLength(content, "utf8");
  const { target, status } = fileStatusDetail(relPath, workspaceRoot);

  return {
    title: status === "exists" ? "Overwrite workspace file" : "Write workspace file",
    summary: metadata.summary,
    riskCategories: metadata.categories,
    target: relPath,
    details: [
      target,
      status === "exists"
        ? "Existing regular file will be fully replaced."
        : status === "missing"
          ? "A new UTF-8 file will be created."
          : "The target could not be confirmed before execution; the tool will validate it again.",
      "Parent directories are created if needed.",
      `Writes ${byteLength} UTF-8 bytes, capped at ${WRITE_FILE_MAX_BYTES} bytes.`,
      "Approval is for full-file replacement, not a patch.",
    ],
  };
}

function buildMcpToolApprovalMetadata(toolName: string): ToolApprovalMetadata {
  const [, serverName = "unknown", mcpToolName = toolName] = toolName.split("__");
  return {
    title: "Call external MCP tool",
    summary: `Calls external MCP tool "${mcpToolName}" from "${serverName}" server.`,
    riskCategories: ["external-integration"],
    target: `${serverName}/${mcpToolName}`,
    details: [
      `MCP server: ${serverName}`,
      `MCP tool: ${mcpToolName}`,
      "The tool runs through the configured MCP server, outside Anton's native workspace sandbox.",
      "Anton still requires approval before invoking this MCP tool.",
    ],
    external: {
      serverName,
      toolName: mcpToolName,
      sandboxedByAnton: false,
    },
  };
}

export function classifyBashCommand(command: string): BashCommandClassification {
  const normalized = command.trim();
  if (!normalized) {
    return {
      categories: ["read-only"],
      forbidden: false,
      reason: "empty command",
    };
  }

  const forbidden = isForbiddenBashCommand(normalized);
  if (forbidden) {
    return {
      categories: ["external-integration"],
      forbidden: true,
      reason: `forbidden command pattern: ${forbidden}`,
    };
  }

  const categories = new Set<ToolRiskCategory>();

  if (isGitCommand(normalized)) categories.add("git");
  if (hasNetworkPattern(normalized)) categories.add("network");
  if (hasPackageInstallPattern(normalized)) categories.add("package-install");
  if (hasLongRunningPattern(normalized)) categories.add("long-running-process");
  if (hasDeletePattern(normalized)) categories.add("delete");
  if (hasWritePattern(normalized)) categories.add("write");
  if (hasExternalIntegrationPattern(normalized)) {
    categories.add("external-integration");
  }

  if (
    isReadOnlyShellCommand(normalized) &&
    (categories.size === 0 || (categories.size === 1 && categories.has("git")))
  ) {
    categories.add("read-only");
  } else if (categories.size === 0) {
    categories.add("write");
  }

  const orderedCategories = orderedRiskCategories(categories);
  return {
    categories: orderedCategories,
    forbidden: false,
    reason: reasonForCategories(orderedCategories),
  };
}

// Commands we refuse to execute in `bash` even after approval — the user
// should never be able to approve these by accident.
export const FORBIDDEN_BASH_PATTERNS: readonly RegExp[] = [
  /(^|\s|;|&&|\|\|)\s*sudo(\s|$)/,
  /(^|\s|;|&&|\|\|)\s*su(\s|$)/,
];

export function isForbiddenBashCommand(command: string): RegExp | null {
  for (const re of FORBIDDEN_BASH_PATTERNS) {
    if (re.test(command)) return re;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function workspaceRootLabel(workspaceRoot: string | undefined): string {
  try {
    return workspaceRoot
      ? ensureWorkspaceRootAt(workspaceRoot)
      : ensureWorkspaceRoot();
  } catch (err) {
    return `unresolved workspace root (${errorMessage(err)})`;
  }
}

function pathDetail(value: unknown, workspaceRoot: string | undefined): string {
  const relPath = stringValue(value);
  if (!relPath) return "Path: (missing)";
  try {
    const root = workspaceRoot
      ? ensureWorkspaceRootAt(workspaceRoot)
      : ensureWorkspaceRoot();
    return `Path: ${relPath} (${resolveInWorkspace(relPath, root)})`;
  } catch (err) {
    return `Path: ${relPath} (${errorMessage(err)})`;
  }
}

function lineRangeDetail(startLine: unknown, endLine: unknown): string {
  const start = numberValue(startLine);
  const end = numberValue(endLine);
  if (start === undefined && end === undefined) return "Line range: default";
  return `Line range: ${start ?? "default"} to ${end ?? "default"}`;
}

function fileStatusDetail(
  relPath: string | undefined,
  workspaceRoot: string | undefined,
): { target: string; status: "exists" | "missing" | "unknown" } {
  if (!relPath) return { target: "Path: (missing)", status: "unknown" };

  try {
    const root = workspaceRoot
      ? ensureWorkspaceRootAt(workspaceRoot)
      : ensureWorkspaceRoot();
    const abs = resolveInWorkspace(relPath, root);
    if (!fs.existsSync(abs)) {
      return { target: `Path: ${relPath} (${abs})`, status: "missing" };
    }
    const stat = fs.statSync(abs);
    return {
      target: `Path: ${relPath} (${abs})`,
      status: stat.isFile() ? "exists" : "unknown",
    };
  } catch (err) {
    return {
      target: `Path: ${relPath} (${errorMessage(err)})`,
      status: "unknown",
    };
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function toolMetadata(
  categories: readonly ToolRiskCategory[],
  requiresApproval: boolean,
  summary: string,
): ToolPermissionMetadata {
  return { categories, requiresApproval, summary };
}

function orderedRiskCategories(
  categories: ReadonlySet<ToolRiskCategory>,
): ToolRiskCategory[] {
  return TOOL_RISK_CATEGORIES.filter((category) => categories.has(category));
}

function reasonForCategories(categories: readonly ToolRiskCategory[]): string {
  if (categories.length === 1 && categories[0] === "read-only") {
    return "matched read-only command patterns";
  }

  return `matched ${categories.join(", ")} command risk patterns`;
}

function isGitCommand(command: string): boolean {
  return /(^|[\s;&|()])git(\s|$)/.test(command);
}

function hasNetworkPattern(command: string): boolean {
  return (
    /\b(?:curl|wget|ssh|scp|sftp|rsync|nc|netcat|telnet|ftp)\b/.test(command) ||
    /\b(?:https?|ssh|git):\/\/\S+/.test(command) ||
    /\bgit@[A-Za-z0-9_.-]+:[^\s]+/.test(command) ||
    /\bgit\s+(?:clone|fetch|pull|push|ls-remote|submodule\s+update)\b/.test(
      command,
    ) ||
    /\bgh\s+(?:api|auth|browse|codespace|gist|issue|pr|release|repo|run|workflow)\b/.test(
      command,
    )
  );
}

function hasPackageInstallPattern(command: string): boolean {
  return (
    /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|remove|rm|update|upgrade|dlx|create|init)\b/.test(
      command,
    ) ||
    /\bnpx\b/.test(command) ||
    /\bpip3?\s+install\b/.test(command) ||
    /\buv\s+(?:add|remove|sync|pip\s+install)\b/.test(command) ||
    /\bpoetry\s+(?:add|install|remove|update)\b/.test(command) ||
    /\bcargo\s+install\b/.test(command) ||
    /\bgo\s+(?:get|install)\b/.test(command) ||
    /\bgem\s+install\b/.test(command) ||
    /\bbundle\s+(?:add|install|update)\b/.test(command) ||
    /\bcomposer\s+(?:install|require|remove|update)\b/.test(command)
  );
}

function hasLongRunningPattern(command: string): boolean {
  return (
    /(^|[\s;&|()])(?:watch|top|htop|less|more)\b/.test(command) ||
    /\b(?:tail)\s+[^;&|]*\s-f\b/.test(command) ||
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview|watch)\b/.test(
      command,
    ) ||
    /\b(?:next|vite|webpack|turbo)\s+(?:dev|start|serve|preview|watch)\b/.test(
      command,
    ) ||
    /\b(?:nodemon|tsx\s+watch|ts-node-dev)\b/.test(command) ||
    /\bpython3?\s+-m\s+http\.server\b/.test(command) ||
    /(^|[\s;&|()])sleep\s+(?:[3-9]\d|\d{3,})\b/.test(command) ||
    /(^|[^&])&\s*(?:$|[#;])/.test(command)
  );
}

function hasDeletePattern(command: string): boolean {
  return (
    /(^|[\s;&|()])(?:rm|unlink|rmdir)\b/.test(command) ||
    /\bfind\b[^;&|]*\s-delete\b/.test(command) ||
    /\bgit\s+(?:clean|reset\s+--hard)\b/.test(command)
  );
}

function hasWritePattern(command: string): boolean {
  return (
    /(^|[^<>])>{1,2}(?![>&])/.test(command) ||
    /(^|[\s;&|()])(?:tee|touch|mkdir|mv|cp|install|chmod|chown|truncate)\b/.test(
      command,
    ) ||
    /\b(?:sed|perl)\s+[^;&|]*\s-i(?:\s|$)/.test(command) ||
    /\bgit\s+(?:add|am|apply|checkout|cherry-pick|commit|merge|mv|rebase|restore|revert|switch|tag)\b/.test(
      command,
    ) ||
    hasPackageInstallPattern(command)
  );
}

function hasExternalIntegrationPattern(command: string): boolean {
  return (
    /\b(?:gh|aws|gcloud|az|vercel|netlify|flyctl|railway|supabase|stripe|kubectl|docker|docker-compose)\b/.test(
      command,
    ) || hasNetworkPattern(command)
  );
}

function isReadOnlyShellCommand(command: string): boolean {
  const segments = command
    .split(/&&|\|\||[;|]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return true;

  return segments.every((segment) => {
    const executable = segment.match(/^(?:env\s+)?([A-Za-z0-9_.-]+)/)?.[1];
    if (!executable) return false;
    if (executable === "git") {
      return /\bgit\s+(?:status|diff|show|log|branch|rev-parse|ls-files)\b/.test(
        segment,
      );
    }
    if (executable === "find" && /\s-delete\b/.test(segment)) return false;
    return READ_ONLY_COMMANDS.has(executable);
  });
}

const READ_ONLY_COMMANDS = new Set([
  "awk",
  "basename",
  "cat",
  "dirname",
  "du",
  "echo",
  "env",
  "file",
  "find",
  "grep",
  "head",
  "jq",
  "ls",
  "pwd",
  "realpath",
  "rg",
  "sed",
  "sort",
  "stat",
  "tail",
  "test",
  "tree",
  "tr",
  "type",
  "wc",
  "which",
]);
