import type { ToolSet } from "ai";
import fs from "node:fs";

import {
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
  resolveInWorkspace,
} from "./sandbox";
import {
  DIFF_PREVIEW_BYTES,
  TEXT_FILE_MAX_BYTES,
  applySingleFilePatch,
  sha256,
} from "./tools/edit-utils";
import { pathGuardReasons } from "./tools/file-guardrails";
import {
  applyTextEditsToContent,
  detectLineEnding,
  normalizeToLF,
  planTextReplacement,
  restoreLineEndings,
  type TextEdit,
} from "./tools/text-edits";
import { planFormatCommand } from "./tools/format";
import {
  classifyBashCommand as classifyBashCommandByPolicy,
  evaluateBashCommandPolicy,
  type BashCommandClassification,
} from "./command-policy";
import { planVerification } from "./tools/verify";
import {
  getWorkspaceExecutionBoundary,
  type WorkspaceExecutionBoundary,
} from "@/src/workspace/process-runner";

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
export type CommandPolicyMode = "enforced" | "advisory";

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
    commandPolicyMode: CommandPolicyMode;
    shell: "bash -lc";
    cwd: string;
    timeoutMs: number;
    outputCapBytes: number;
    boundary: WorkspaceExecutionBoundary;
    classification: BashCommandClassification;
  };
  external?: {
    serverName: string;
    toolName: string;
    sandboxedByAnton: boolean;
  };
};

const BASH_DEFAULT_TIMEOUT_MS = 180_000;
const BASH_SEARCH_COMMAND_TIMEOUT_MS = 240_000;
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
    "Creates a new workspace file.",
  ),
  edit_file: toolMetadata(
    ["write"],
    true,
    "Applies a patch to an existing workspace file.",
  ),
  edit_text: toolMetadata(
    ["write"],
    true,
    "Applies exact oldText/newText edits to an existing workspace file.",
  ),
  replace_text: toolMetadata(
    ["write"],
    true,
    "Replaces one exact text span in an existing workspace file.",
  ),
  replace_lines: toolMetadata(
    ["write"],
    true,
    "Replaces ordered line ranges in an existing workspace file.",
  ),
  multi_replace_text: toolMetadata(
    ["write"],
    true,
    "Applies ordered exact-text replacements to one existing workspace file.",
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
  format: toolMetadata(
    ["write"],
    true,
    "Runs the workspace formatter through the detected package manager.",
  ),
  git_status: toolMetadata(
    ["read-only", "git"],
    false,
    "Reads git working tree status.",
  ),
  git_diff: toolMetadata(
    ["read-only", "git"],
    false,
    "Reads a scoped git diff and diff hash.",
  ),
  git_show: toolMetadata(
    ["read-only", "git"],
    false,
    "Reads one git revision or commit.",
  ),
  git_branch: toolMetadata(
    ["git"],
    true,
    "Inspects, creates, or switches git branches.",
  ),
  git_commit: toolMetadata(
    ["write", "git"],
    true,
    "Stages explicit paths and creates a git commit.",
  ),
  git_restore: toolMetadata(
    ["write", "delete", "git"],
    true,
    "Restores explicit tracked paths with git restore.",
  ),
  revert_changes: toolMetadata(
    ["write", "delete", "git"],
    true,
    "Reverts scoped workspace changes after diff-hash confirmation.",
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
  inspect_project: READ_ONLY,
  verify: toolMetadata(
    ["write", "long-running-process"],
    true,
    "Runs available package verification scripts in the workspace.",
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
  update_todos: READ_ONLY,
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
  permissionMode = "auto-review",
}: {
  toolName: string;
  input: unknown;
  workspaceRoot?: string;
  permissionMode?: PermissionMode;
}): ToolApprovalMetadata | undefined {
  const nativeMetadata = getNativeToolPermissionMetadata(toolName);
  if (nativeMetadata) {
    return buildNativeToolApprovalMetadata(
      toolName,
      input,
      workspaceRoot,
      permissionMode,
    );
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
  options: { workspaceRoot?: string } = {},
): BashCommandClassification | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const command = (input as Record<string, unknown>)["command"];
  if (typeof command !== "string") return undefined;
  return evaluateBashCommandPolicy(command, options).classification;
}

export function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__");
}

function buildNativeToolApprovalMetadata(
  toolName: string,
  input: unknown,
  workspaceRoot: string | undefined,
  permissionMode: PermissionMode,
): ToolApprovalMetadata | undefined {
  const metadata = getNativeToolPermissionMetadata(toolName);
  if (!metadata) return undefined;
  const record = isRecord(input) ? input : {};

  switch (toolName) {
    case "bash":
      return buildBashApproval(record, metadata, workspaceRoot, permissionMode);
    case "edit_file":
      return buildEditFileApproval(record, metadata, workspaceRoot);
    case "edit_text":
      return buildEditTextApproval(record, metadata, workspaceRoot);
    case "replace_text":
      return buildReplaceTextApproval(record, metadata, workspaceRoot);
    case "replace_lines":
      return buildReplaceLinesApproval(record, metadata, workspaceRoot);
    case "multi_replace_text":
      return buildMultiReplaceTextApproval(record, metadata, workspaceRoot);
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
    case "format":
      return buildFormatApproval(record, metadata, workspaceRoot);
    case "git_status":
      return buildGitApproval({
        title: "Inspect git status",
        input: record,
        metadata,
        details: ["Runs git status using porcelain output."],
      });
    case "git_diff":
      return buildGitApproval({
        title: "Inspect git diff",
        input: record,
        metadata,
        details: [
          pathsDetail(record.paths, workspaceRoot),
          `Staged: ${booleanValue(record.staged) ? "yes" : "no"}.`,
          "Returns a patch and SHA-256 diff hash for scoped revert confirmation.",
        ],
      });
    case "git_show":
      return buildGitApproval({
        title: "Inspect git revision",
        input: record,
        metadata,
        target: stringValue(record.ref) ?? "HEAD",
        details: [
          `Ref: ${stringValue(record.ref) ?? "HEAD"}.`,
          `Stat only: ${booleanValue(record.stat) ? "yes" : "no"}.`,
        ],
      });
    case "git_branch":
      return buildGitApproval({
        title: "Manage git branch",
        input: record,
        metadata,
        target: stringValue(record.name),
        details: [
          `Action: ${stringValue(record.action) ?? "(missing)"}.`,
          `Branch: ${stringValue(record.name) ?? "(current/list)"}.`,
          "New branch names get a codex/ prefix when no prefix is supplied.",
        ],
      });
    case "git_commit":
      return buildGitApproval({
        title: "Create git commit",
        input: record,
        metadata,
        target: stringValue(record.message),
        details: [
          `Message: ${stringValue(record.message) ?? "(missing)"}.`,
          pathsDetail(record.paths, workspaceRoot),
          guardedDetail(record.allowGuarded),
        ],
      });
    case "git_restore":
      return buildGitApproval({
        title: "Restore git paths",
        input: record,
        metadata,
        details: [
          pathsDetail(record.paths, workspaceRoot),
          `Restore staged: ${booleanValue(record.staged) ? "yes" : "no"}.`,
          `Restore worktree: ${record.worktree === false ? "no" : "yes"}.`,
          guardedDetail(record.allowGuarded),
        ],
      });
    case "revert_changes":
      return buildGitApproval({
        title: "Revert workspace changes",
        input: record,
        metadata,
        details: [
          pathsDetail(record.paths, workspaceRoot),
          `Expected diff hash: ${stringValue(record.expectedDiffHash) ?? "(missing)"}.`,
          "The tool recomputes git_diff for the same scope before restoring files.",
          guardedDetail(record.allowGuarded),
        ],
      });
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
    case "inspect_project":
      return {
        title: "Inspect active project",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        details: [
          "Reads package.json, known root config files, and git status.",
          "Does not read source file contents or modify workspace files.",
        ],
      };
    case "verify":
      return buildVerifyApproval(record, metadata, workspaceRoot);
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
    case "update_todos":
      return {
        title: "Update todo checklist",
        summary: metadata.summary,
        riskCategories: metadata.categories,
        details: [
          "Publishes the current implementation checklist to the chat trace.",
          "Does not read, write, or mutate workspace files.",
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

function buildVerifyApproval(
  input: Record<string, unknown>,
  metadata: ToolPermissionMetadata,
  workspaceRoot: string | undefined,
): ToolApprovalMetadata {
  const targets = stringArrayValue(input.targets);
  const plan = planVerification(
    workspaceRoot ? workspaceRootLabel(workspaceRoot) : workspaceRoot,
    {
      targets: targets.filter(isVerificationTarget),
    },
  );
  const commands = plan.ok
    ? plan.steps
        .map((step) =>
          step.command
            ? `${step.target}: ${step.command.join(" ")}`
            : `${step.target}: skipped (${step.reason ?? "script unavailable"})`,
        )
        .join("; ")
    : plan.error;

  return {
    title: "Run verification scripts",
    summary: metadata.summary,
    riskCategories: metadata.categories,
    target: targets.length > 0 ? targets.join(", ") : "typecheck, lint, build",
    details: [
      `Targets: ${targets.length > 0 ? targets.join(", ") : "typecheck, lint, build"}.`,
      `Commands: ${commands}.`,
      `Timeout per command: ${numberValue(input.timeoutMs) ?? 120_000}ms.`,
      "Runs package scripts directly through the detected package manager without shell interpolation.",
    ],
  };
}

function buildBashApproval(
  input: Record<string, unknown>,
  metadata: ToolPermissionMetadata,
  workspaceRoot: string | undefined,
  permissionMode: PermissionMode,
): ToolApprovalMetadata {
  const command = stringValue(input.command) ?? "";
  const timeoutMs =
    numberValue(input.timeoutMs) ??
    (looksLikeSearchCommand(command)
      ? BASH_SEARCH_COMMAND_TIMEOUT_MS
      : BASH_DEFAULT_TIMEOUT_MS);
  const cwd = workspaceRootLabel(workspaceRoot);
  const policy = evaluateBashCommandPolicy(command, { workspaceRoot });
  const classification = policy.classification;
  const commandPolicyMode = commandPolicyModeForPermission(permissionMode);
  const boundary = getWorkspaceExecutionBoundary();

  return {
    title: "Run shell command",
    summary: metadata.summary,
    riskCategories: classification.categories,
    target: command,
    command: {
      command,
      commandPolicyMode,
      shell: "bash -lc",
      cwd,
      timeoutMs,
      outputCapBytes: BASH_OUTPUT_CAP_BYTES,
      boundary,
      classification,
    },
    details: [
      `Command: ${command || "(empty)"}`,
      `Shell: bash -lc`,
      `Command policy mode: ${commandPolicyMode}.`,
      `Working directory: ${cwd}`,
      `Timeout: ${timeoutMs}ms`,
      `Output cap: ${BASH_OUTPUT_CAP_BYTES} bytes per stream.`,
      `Execution boundary: ${boundary.label}.`,
      "Confinement: Unconfined.",
      `Classification: ${classification.reason}.`,
      commandPolicyMode === "advisory"
        ? "Full-access mode treats command policy classification as advisory; cwd, environment allowlist, timeout, output limits, and redaction still apply. OS confinement is not provided."
        : !policy.allowed
        ? "This command violates command policy and will be refused even if approved."
        : "Approval lets the command start; cwd, environment allowlist, timeout, output limits, and redaction still apply. OS confinement is not provided.",
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
    workspaceRoot,
  );
  const previewDetails = diff.message ? [diff.message] : [];

  return {
    title: "Create workspace file",
    summary: metadata.summary,
    riskCategories: metadata.categories,
    target: relPath,
    diffPreview: diff.preview,
    details: [
      target,
      status === "exists"
        ? "Existing files are rejected; use edit_text or edit_file instead."
        : status === "missing"
          ? "A new UTF-8 file will be created."
          : "The target could not be confirmed before execution; the tool will validate it again.",
      "Parent directories are created if needed.",
      `Writes ${byteLength} UTF-8 bytes, capped at ${WRITE_FILE_MAX_BYTES} bytes.`,
      `Expected hash: ${stringValue(input.expectedHash) ?? "not provided"}.`,
      "Approval is for new-file creation, not replacement.",
      ...previewDetails,
    ],
  };
}

function buildFormatApproval(
  input: Record<string, unknown>,
  metadata: ToolPermissionMetadata,
  workspaceRoot: string | undefined,
): ToolApprovalMetadata {
  const paths = stringArrayValue(input.paths);
  const plan = planFormatCommand(
    workspaceRoot ? workspaceRootLabel(workspaceRoot) : workspaceRoot,
    { paths },
  );
  const command = plan.ok ? plan.command.join(" ") : "(formatter unavailable)";
  return {
    title: "Format workspace files",
    summary: metadata.summary,
    riskCategories: metadata.categories,
    target: paths.length > 0 ? paths.join(", ") : "formatter default target",
    details: [
      pathsDetail(input.paths, workspaceRoot),
      `Command: ${command}.`,
      plan.ok ? `Detected package manager: ${plan.packageManager}.` : plan.error,
      guardedDetail(input.allowGuarded),
    ],
  };
}

function buildGitApproval({
  title,
  input,
  metadata,
  target,
  details,
}: {
  title: string;
  input: Record<string, unknown>;
  metadata: ToolPermissionMetadata;
  target?: string;
  details: readonly string[];
}): ToolApprovalMetadata {
  return {
    title,
    summary: metadata.summary,
    riskCategories: metadata.categories,
    target: target ?? stringValue(input.path),
    details,
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

function buildEditTextApproval(
  input: Record<string, unknown>,
  metadata: ToolPermissionMetadata,
  workspaceRoot: string | undefined,
): ToolApprovalMetadata {
  const relPath = stringValue(input.path);
  const edits = Array.isArray(input.edits) ? input.edits : [];
  const diff = buildEditTextDiffPreview({
    relPath,
    edits,
    workspaceRoot,
  });
  const previewDetails = diffPreviewDetails(diff);

  return {
    title: "Edit workspace file (exact text)",
    summary: metadata.summary,
    riskCategories: metadata.categories,
    target: relPath,
    diffPreview: diff.preview,
    details: [
      pathDetail(relPath, workspaceRoot),
      "Reads the current file from disk and applies ordered oldText/newText edits atomically.",
      `Edit count: ${edits.length}.`,
      "No expectedHash is required; the harness uses the live file snapshot.",
      ...previewDetails,
    ],
  };
}

function buildReplaceTextApproval(
  input: Record<string, unknown>,
  metadata: ToolPermissionMetadata,
  workspaceRoot: string | undefined,
): ToolApprovalMetadata {
  const relPath = stringValue(input.path);
  const find = stringValue(input.find) ?? "";
  const replace = stringValue(input.replace) ?? "";
  const diff = buildReplaceTextDiffPreview({
    relPath,
    find,
    replace,
    replaceAll: booleanValue(input.replaceAll),
    expectedHash: stringValue(input.expectedHash),
    workspaceRoot,
  });
  const previewDetails = diffPreviewDetails(diff);

  return {
    title: "Replace text in workspace file",
    summary: metadata.summary,
    riskCategories: metadata.categories,
    target: relPath,
    diffPreview: diff.preview,
    details: [
      pathDetail(relPath, workspaceRoot),
      "Replaces one exact text span when expectedHash matches.",
      `Find length: ${find.length} chars.`,
      `Replace length: ${replace.length} chars.`,
      `Replace all: ${booleanValue(input.replaceAll) ? "yes" : "no"}.`,
      `Expected hash: ${stringValue(input.expectedHash) ?? "(missing)"}.`,
      ...previewDetails,
    ],
  };
}

function buildMultiReplaceTextApproval(
  input: Record<string, unknown>,
  metadata: ToolPermissionMetadata,
  workspaceRoot: string | undefined,
): ToolApprovalMetadata {
  const relPath = stringValue(input.path);
  const replacements = Array.isArray(input.replacements) ? input.replacements : [];
  const diff = buildMultiReplaceTextDiffPreview({
    relPath,
    replacements,
    expectedHash: stringValue(input.expectedHash),
    workspaceRoot,
  });
  const previewDetails = diffPreviewDetails(diff);

  return {
    title: "Apply ordered replacements in workspace file",
    summary: metadata.summary,
    riskCategories: metadata.categories,
    target: relPath,
    diffPreview: diff.preview,
    details: [
      pathDetail(relPath, workspaceRoot),
      "Applies ordered exact-text replacements atomically when expectedHash matches.",
      `Replacement count: ${replacements.length}.`,
      `Expected hash: ${stringValue(input.expectedHash) ?? "(missing)"}.`,
      ...previewDetails,
    ],
  };
}

function buildReplaceLinesApproval(
  input: Record<string, unknown>,
  metadata: ToolPermissionMetadata,
  workspaceRoot: string | undefined,
): ToolApprovalMetadata {
  const relPath = stringValue(input.path);
  const edits = Array.isArray(input.edits) ? input.edits : [];
  const diff = buildReplaceLinesDiffPreview({
    relPath,
    edits,
    expectedHash: stringValue(input.expectedHash),
    workspaceRoot,
  });
  const previewDetails = diff.message ? [diff.message] : [];

  return {
    title: "Replace line ranges in workspace file",
    summary: metadata.summary,
    riskCategories: metadata.categories,
    target: relPath,
    diffPreview: diff.preview,
    details: [
      pathDetail(relPath, workspaceRoot),
      "Applies ordered, non-overlapping line-range replacements atomically when expectedHash matches.",
      `Edit count: ${edits.length}.`,
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

export function commandPolicyModeForPermission(
  permissionMode: PermissionMode,
): CommandPolicyMode {
  return permissionMode === "full-access" ? "advisory" : "enforced";
}

function looksLikeSearchCommand(command: string): boolean {
  const trimmed = command.trim();
  return /^(grep|rg|find)\b/.test(trimmed);
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

function diffPreviewDetails(diff: TextDiffPreviewResult): string[] {
  const details: string[] = [];
  if (diff.message) details.push(diff.message);
  if (diff.recoveredEditCount && diff.recoveredEditCount > 0) {
    details.push(
      diff.recoveredEditCount === 1
        ? "Diff preview uses one unique indentation-only match."
        : `Diff preview uses ${diff.recoveredEditCount} unique indentation-only matches.`,
    );
  }
  return details;
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

function pathsDetail(value: unknown, workspaceRoot: string | undefined): string {
  const paths = stringArrayValue(value);
  if (paths.length === 0) return "Paths: repository scope.";
  return `Paths: ${paths
    .map((relPath) => pathDetailText(relPath, workspaceRoot))
    .join(", ")}`;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function textEditsFromUnknown(edits: unknown[]): TextEdit[] {
  return edits.flatMap((edit) => {
    if (!isRecord(edit)) return [];
    const oldText = stringValue(edit.oldText);
    const newText = stringValue(edit.newText);
    if (oldText === undefined || newText === undefined) return [];
    return [
      {
        oldText,
        newText,
        ...(booleanValue(edit.replaceAll) ? { replaceAll: true } : {}),
      },
    ];
  });
}

function replacementsFromUnknown(
  replacements: unknown[],
): Array<{ find: string; replace: string }> {
  return replacements.flatMap((replacement) => {
    if (!isRecord(replacement)) return [];
    const find = stringValue(replacement.find);
    const replace = stringValue(replacement.replace);
    if (find === undefined || replace === undefined) return [];
    return [{ find, replace }];
  });
}

function isVerificationTarget(
  value: string,
): value is "typecheck" | "lint" | "build" {
  return value === "typecheck" || value === "lint" || value === "build";
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

type TextDiffPreviewResult = {
  preview?: ToolApprovalMetadata["diffPreview"];
  message?: string;
  recoveredEditCount?: number;
};

function buildEditTextDiffPreview({
  relPath,
  edits,
  workspaceRoot,
}: {
  relPath: string | undefined;
  edits: unknown[];
  workspaceRoot: string | undefined;
}): TextDiffPreviewResult {
  if (!relPath) return { message: "Diff preview unavailable: path is missing." };
  if (edits.length === 0) {
    return { message: "Diff preview unavailable: no text edits provided." };
  }
  const normalizedEdits = textEditsFromUnknown(edits);
  if (normalizedEdits.length !== edits.length) {
    return { message: "Diff preview unavailable: text edits are invalid." };
  }
  try {
    const current = readPreviewTextSync(relPath, workspaceRoot);
    if (!current.ok) return { message: current.message };
    const result = applyTextEditsToContent(current.content, normalizedEdits, {
      allowIndentationRecovery: !current.guarded,
      maxBytes: TEXT_FILE_MAX_BYTES,
      recoveryDisabledReason: current.guarded ? "guarded" : undefined,
    });
    if (!result.ok) {
      return {
        message: `Diff preview unavailable: edit ${result.index + 1} would fail with ${result.code}: ${result.message}.`,
      };
    }
    if (Buffer.byteLength(result.content, "utf8") > DIFF_PREVIEW_BYTES) {
      return {
        message: `Diff preview omitted because patched content is too large and exceeds ${DIFF_PREVIEW_BYTES} bytes.`,
      };
    }
    return {
      preview: {
        path: relPath,
        previous: current.content,
        next: result.content,
        truncated: false,
      },
      recoveredEditCount: result.recoveredEditCount,
    };
  } catch (err) {
    return { message: `Diff preview unavailable: ${errorMessage(err)}.` };
  }
}

function buildReplaceTextDiffPreview({
  relPath,
  find,
  replace,
  replaceAll,
  expectedHash,
  workspaceRoot,
}: {
  relPath: string | undefined;
  find: string;
  replace: string;
  replaceAll: boolean;
  expectedHash: string | undefined;
  workspaceRoot: string | undefined;
}): TextDiffPreviewResult {
  if (!relPath) return { message: "Diff preview unavailable: path is missing." };
  if (!find) return { message: "Diff preview unavailable: find text is missing." };
  try {
    const current = readPreviewTextSync(relPath, workspaceRoot);
    if (!current.ok) return { message: current.message };
    if (expectedHash && current.sha256 !== expectedHash) {
      return {
        message: `Diff preview unavailable because expectedHash does not match current file hash ${current.sha256}.`,
      };
    }
    const lineEnding = detectLineEnding(current.content);
    const plan = planTextReplacement({
      content: normalizeToLF(current.content),
      find: normalizeToLF(find),
      replace: normalizeToLF(replace),
      replaceAll,
      allowIndentationRecovery: !current.guarded && !replaceAll,
      maxBytes: TEXT_FILE_MAX_BYTES,
      recoveryDisabledReason: current.guarded
        ? "guarded"
        : replaceAll
          ? "replaceAll"
          : undefined,
    });
    if (!plan.ok) {
      return {
        message: `Diff preview unavailable: replacement would fail with ${plan.code}: ${plan.message}.`,
      };
    }
    const next = restoreLineEndings(plan.content, lineEnding);
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
      recoveredEditCount: plan.strategy === "indentation" ? 1 : 0,
    };
  } catch (err) {
    return { message: `Diff preview unavailable: ${errorMessage(err)}.` };
  }
}

function buildMultiReplaceTextDiffPreview({
  relPath,
  replacements,
  expectedHash,
  workspaceRoot,
}: {
  relPath: string | undefined;
  replacements: unknown[];
  expectedHash: string | undefined;
  workspaceRoot: string | undefined;
}): TextDiffPreviewResult {
  if (!relPath) return { message: "Diff preview unavailable: path is missing." };
  if (replacements.length === 0) {
    return { message: "Diff preview unavailable: no replacements provided." };
  }
  const normalizedReplacements = replacementsFromUnknown(replacements);
  if (normalizedReplacements.length !== replacements.length) {
    return { message: "Diff preview unavailable: replacements are invalid." };
  }
  try {
    const current = readPreviewTextSync(relPath, workspaceRoot);
    if (!current.ok) return { message: current.message };
    if (expectedHash && current.sha256 !== expectedHash) {
      return {
        message: `Diff preview unavailable because expectedHash does not match current file hash ${current.sha256}.`,
      };
    }
    const lineEnding = detectLineEnding(current.content);
    let stagedContent = normalizeToLF(current.content);
    let recoveredEditCount = 0;
    for (const [index, replacement] of normalizedReplacements.entries()) {
      const plan = planTextReplacement({
        content: stagedContent,
        find: normalizeToLF(replacement.find),
        replace: normalizeToLF(replacement.replace),
        allowIndentationRecovery: !current.guarded,
        maxBytes: TEXT_FILE_MAX_BYTES,
        recoveryDisabledReason: current.guarded ? "guarded" : undefined,
      });
      if (!plan.ok) {
        return {
          message: `Diff preview unavailable: replacement ${index + 1} would fail with ${plan.code}: ${plan.message}.`,
        };
      }
      stagedContent = plan.content;
      if (plan.strategy === "indentation") recoveredEditCount += 1;
    }
    const next = restoreLineEndings(stagedContent, lineEnding);
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
      recoveredEditCount,
    };
  } catch (err) {
    return { message: `Diff preview unavailable: ${errorMessage(err)}.` };
  }
}

function buildReplaceLinesDiffPreview({
  relPath,
  edits,
  expectedHash,
  workspaceRoot,
}: {
  relPath: string | undefined;
  edits: unknown[];
  expectedHash: string | undefined;
  workspaceRoot: string | undefined;
}): {
  preview?: ToolApprovalMetadata["diffPreview"];
  message?: string;
} {
  if (!relPath) return { message: "Diff preview unavailable: path is missing." };
  if (edits.length === 0) {
    return { message: "Diff preview unavailable: no line edits provided." };
  }
  try {
    const current = readPreviewTextSync(relPath, workspaceRoot);
    if (!current.ok) return { message: current.message };
    if (expectedHash && current.sha256 !== expectedHash) {
      return {
        message: `Diff preview unavailable because expectedHash does not match current file hash ${current.sha256}.`,
      };
    }
    const normalized = edits.flatMap((edit, index) => {
      if (!isRecord(edit)) return [];
      const startLine = numberValue(edit.startLine);
      const endLine = numberValue(edit.endLine);
      const replacement = stringValue(edit.replacement);
      if (startLine === undefined || endLine === undefined || replacement === undefined) {
        return [];
      }
      return [{ startLine, endLine, replacement, index }];
    });
    if (normalized.length === 0) {
      return { message: "Diff preview unavailable: line edits are invalid." };
    }
    const lines = current.content.split("\n");
    const sorted = [...normalized].sort((left, right) => right.startLine - left.startLine);
    for (const edit of sorted) {
      lines.splice(
        edit.startLine - 1,
        edit.endLine - edit.startLine + 1,
        ...edit.replacement.split("\n"),
      );
    }
    const next = lines.join("\n");
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
    return {
      message:
        "Diff preview omitted because write_file only creates new files; use edit_text or edit_file for existing files.",
    };
  } catch (err) {
    return { message: `Diff preview unavailable: ${errorMessage(err)}.` };
  }
}

function readPreviewTextSync(
  relPath: string,
  workspaceRoot: string | undefined,
):
  | { ok: true; content: string; sha256: string; guarded: boolean }
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
  const lstat = fs.lstatSync(abs);
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
  return {
    ok: true,
    content,
    sha256: sha256(bytes),
    guarded: lstat.isSymbolicLink() || pathGuardReasons(relPath).length > 0,
  };
}

function toolMetadata(
  categories: readonly ToolRiskCategory[],
  requiresApproval: boolean,
  summary: string,
): ToolPermissionMetadata {
  return { categories, requiresApproval, summary };
}
