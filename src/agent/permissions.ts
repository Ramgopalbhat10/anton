import type { ToolSet } from "ai";
import fs from "node:fs";

import {
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
  resolveInWorkspace,
} from "./sandbox";
import {
  DIFF_PREVIEW_BYTES,
  applySingleFilePatch,
  sha256,
} from "./tools/edit-utils";
import {
  classifyBashCommand as classifyBashCommandByPolicy,
  type BashCommandClassification,
} from "./command-policy";

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

export type ToolApprovalMetadata = {
  title: string;
  summary: string;
  riskCategories: readonly ToolRiskCategory[];
  details: readonly string[];
  target?: string;
  diffPreview?: {
    path: string;
    previous: string;
    next: string;
    truncated: boolean;
  };
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
    "Creates or explicitly replaces a workspace file.",
  ),
  edit_file: toolMetadata(
    ["write"],
    true,
    "Applies a patch to an existing workspace file.",
  ),
  read_dir: READ_ONLY,
  stat: READ_ONLY,
  mkdir: toolMetadata(
    ["write"],
    true,
    "Creates a workspace directory.",
  ),
  delete: toolMetadata(
    ["delete"],
    true,
    "Deletes a workspace file or directory.",
  ),
  rename: toolMetadata(
    ["write", "delete"],
    true,
    "Renames or moves a workspace file or directory.",
  ),
  copy: toolMetadata(
    ["write"],
    true,
    "Copies a workspace file or directory.",
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
    case "edit_file":
      return buildEditFileApproval(record, metadata, workspaceRoot);
    case "write_file":
      return buildWriteFileApproval(record, metadata, workspaceRoot);
    case "read_dir":
      return {
        title: "Read workspace directory",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        target: stringValue(record.path) ?? "workspace root",
        details: [
          pathDetail(record.path ?? ".", workspaceRoot),
          "Lists immediate directory children with file metadata only.",
        ],
      };
    case "stat":
      return {
        title: "Inspect workspace path",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        target: stringValue(record.path),
        details: [
          pathDetail(record.path, workspaceRoot),
          "Returns file type, size, timestamps, hash when available, and guardrail reasons.",
        ],
      };
    case "mkdir":
      return buildFileOperationApproval({
        title: "Create workspace directory",
        input: record,
        metadata,
        details: [
          pathDetail(record.path, workspaceRoot),
          `Recursive: ${booleanValue(record.recursive) || record.recursive === undefined ? "yes" : "no"}.`,
          guardedDetail(record.allowGuarded),
        ],
      });
    case "delete":
      return buildFileOperationApproval({
        title: "Delete workspace path",
        input: record,
        metadata,
        details: [
          pathDetail(record.path, workspaceRoot),
          `Recursive: ${booleanValue(record.recursive) ? "yes" : "no"}.`,
          `Expected hash: ${stringValue(record.expectedHash) ?? "(missing for regular files)"}.`,
          guardedDetail(record.allowGuarded),
        ],
      });
    case "rename":
      return {
        title: "Rename workspace path",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        target: stringValue(record.sourcePath),
        details: [
          `Source: ${pathDetailText(record.sourcePath, workspaceRoot)}`,
          `Destination: ${pathDetailText(record.destinationPath, workspaceRoot)}`,
          `Expected source hash: ${stringValue(record.expectedSourceHash) ?? "(missing for regular files)"}.`,
          "The destination must not already exist.",
          guardedDetail(record.allowGuarded),
        ],
      };
    case "copy":
      return {
        title: "Copy workspace path",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        target: stringValue(record.sourcePath),
        details: [
          `Source: ${pathDetailText(record.sourcePath, workspaceRoot)}`,
          `Destination: ${pathDetailText(record.destinationPath, workspaceRoot)}`,
          `Recursive: ${booleanValue(record.recursive) ? "yes" : "no"}.`,
          `Expected source hash: ${stringValue(record.expectedSourceHash) ?? "(missing for regular files)"}.`,
          "The destination must not already exist.",
          guardedDetail(record.allowGuarded),
        ],
      };
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
  const diff = buildWriteFileDiffPreview(
    relPath,
    content,
    stringValue(input.expectedHash),
    workspaceRoot,
  );
  const previewDetails = diff.message ? [diff.message] : [];

  return {
    title: status === "exists" ? "Overwrite workspace file" : "Write workspace file",
    summary: metadata.summary,
    riskCategories: metadata.categories,
    target: relPath,
    diffPreview: diff.preview,
    details: [
      target,
      status === "exists"
        ? "Existing regular file will be fully replaced only if expectedHash matches."
        : status === "missing"
          ? "A new UTF-8 file will be created."
          : "The target could not be confirmed before execution; the tool will validate it again.",
      "Parent directories are created if needed.",
      `Writes ${byteLength} UTF-8 bytes, capped at ${WRITE_FILE_MAX_BYTES} bytes.`,
      `Expected hash: ${stringValue(input.expectedHash) ?? "not provided"}.`,
      "Approval is for full-file replacement, not a patch.",
      ...previewDetails,
    ],
  };
}

function buildEditFileApproval(
  input: Record<string, unknown>,
  metadata: ToolPermissionMetadata,
  workspaceRoot: string | undefined,
): ToolApprovalMetadata {
  const relPath = stringValue(input.path);
  const patch = stringValue(input.patch) ?? "";
  const diff = buildEditFileDiffPreview(
    relPath,
    patch,
    stringValue(input.expectedHash),
    workspaceRoot,
  );
  const previewDetails = diff.message ? [diff.message] : [];

  return {
    title: "Patch workspace file",
    summary: metadata.summary,
    riskCategories: metadata.categories,
    target: relPath,
    diffPreview: diff.preview,
    details: [
      pathDetail(relPath, workspaceRoot),
      "Applies one single-file unified diff to an existing UTF-8 file.",
      "The patch is applied with zero fuzz; context must match exactly.",
      `Expected hash: ${stringValue(input.expectedHash) ?? "(missing)"}.`,
      ...previewDetails,
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
  return classifyBashCommandByPolicy(command);
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

function pathDetailText(value: unknown, workspaceRoot: string | undefined): string {
  return pathDetail(value, workspaceRoot).replace(/^Path: /, "");
}

function guardedDetail(value: unknown): string {
  return booleanValue(value)
    ? "Guarded targets are explicitly allowed for this call."
    : "Guarded targets such as lockfiles, migrations, generated files, binary files, and large files are refused by default.";
}

function buildFileOperationApproval({
  title,
  input,
  metadata,
  details,
}: {
  title: string;
  input: Record<string, unknown>;
  metadata: ToolPermissionMetadata;
  details: readonly string[];
}): ToolApprovalMetadata {
  return {
    title,
    summary: metadata.summary,
    riskCategories: metadata.categories,
    target: stringValue(input.path),
    details,
  };
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

function buildEditFileDiffPreview(
  relPath: string | undefined,
  patch: string,
  expectedHash: string | undefined,
  workspaceRoot: string | undefined,
): {
  preview?: ToolApprovalMetadata["diffPreview"];
  message?: string;
} {
  if (!relPath) return { message: "Diff preview unavailable: path is missing." };
  try {
    const current = readPreviewTextSync(relPath, workspaceRoot);
    if (!current.ok) return { message: current.message };
    if (expectedHash && current.sha256 !== expectedHash) {
      return {
        message: `Diff preview unavailable because expectedHash does not match current file hash ${current.sha256}.`,
      };
    }
    const next = applySingleFilePatch({
      source: current.content,
      patch,
      relPath,
    });
    if (Buffer.byteLength(next, "utf8") > DIFF_PREVIEW_BYTES) {
      return {
        message: `Diff preview omitted because patched content is too large and exceeds ${DIFF_PREVIEW_BYTES} bytes.`,
      };
    }
    return {
      preview: {
        path: relPath,
        previous: current.content,
        next,
        truncated: false,
      },
    };
  } catch (err) {
    return { message: `Diff preview unavailable: ${errorMessage(err)}.` };
  }
}

function buildWriteFileDiffPreview(
  relPath: string | undefined,
  content: string,
  expectedHash: string | undefined,
  workspaceRoot: string | undefined,
): {
  preview?: ToolApprovalMetadata["diffPreview"];
  message?: string;
} {
  if (!relPath) return { message: "Diff preview unavailable: path is missing." };
  if (Buffer.byteLength(content, "utf8") > DIFF_PREVIEW_BYTES) {
    return {
      message: `Diff preview omitted because proposed content is too large and exceeds ${DIFF_PREVIEW_BYTES} bytes.`,
    };
  }
  try {
    const current = readPreviewTextSync(relPath, workspaceRoot);
    if (!current.ok) {
      if (current.reason === "missing") {
        return {
          preview: {
            path: relPath,
            previous: "",
            next: content,
            truncated: false,
          },
        };
      }
      return { message: current.message };
    }
    if (expectedHash && current.sha256 !== expectedHash) {
      return {
        message: `Diff preview unavailable because expectedHash does not match current file hash ${current.sha256}.`,
      };
    }
    return {
      preview: {
        path: relPath,
        previous: current.content,
        next: content,
        truncated: false,
      },
    };
  } catch (err) {
    return { message: `Diff preview unavailable: ${errorMessage(err)}.` };
  }
}

function readPreviewTextSync(
  relPath: string,
  workspaceRoot: string | undefined,
):
  | { ok: true; content: string; sha256: string }
  | { ok: false; reason: "missing" | "too-large" | "invalid"; message: string } {
  const root = workspaceRoot
    ? ensureWorkspaceRootAt(workspaceRoot)
    : ensureWorkspaceRoot();
  const abs = resolveInWorkspace(relPath, root);
  if (!fs.existsSync(abs)) {
    return {
      ok: false,
      reason: "missing",
      message: "Diff preview treats this as a new file.",
    };
  }
  const stat = fs.statSync(abs);
  if (!stat.isFile()) {
    return {
      ok: false,
      reason: "invalid",
      message: "Diff preview unavailable because target is not a regular file.",
    };
  }
  if (stat.size > DIFF_PREVIEW_BYTES) {
    return {
      ok: false,
      reason: "too-large",
      message: `Diff preview omitted because existing file is too large and exceeds ${DIFF_PREVIEW_BYTES} bytes.`,
    };
  }
  const bytes = fs.readFileSync(abs);
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      reason: "invalid",
      message: "Diff preview unavailable because target is not valid UTF-8 text.",
    };
  }
  if (content.includes("\0")) {
    return {
      ok: false,
      reason: "invalid",
      message: "Diff preview unavailable because target appears to be binary.",
    };
  }
  return { ok: true, content, sha256: sha256(bytes) };
}

function toolMetadata(
  categories: readonly ToolRiskCategory[],
  requiresApproval: boolean,
  summary: string,
): ToolPermissionMetadata {
  return { categories, requiresApproval, summary };
}
