import path from "node:path";

import { ensureWorkspaceRoot, ensureWorkspaceRootAt } from "../sandbox";
import {
  detectPackageManager,
  execCommand,
  hasDependency,
  readPackageJson,
  runScriptCommand,
  scriptNames,
} from "./package-manager";
import { runWorkspaceProcess } from "./process";

export type PostEditLintIssue = {
  line: number;
  column: number;
  message: string;
  ruleId?: string;
};

export type PostEditLintResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false }
  | {
      ok: false;
      skipped: false;
      issues: PostEditLintIssue[];
      summary: string;
      rawOutput?: string;
    };

const LINT_TIMEOUT_MS = 30_000;

export async function lintEditedFile(
  relPath: string,
  workspaceRoot?: string,
): Promise<PostEditLintResult> {
  const root = workspaceRoot
    ? ensureWorkspaceRootAt(workspaceRoot)
    : ensureWorkspaceRoot();
  const packageJson = readPackageJson(root);
  if (!packageJson.ok) {
    return { ok: true, skipped: true, reason: packageJson.error };
  }

  const ext = path.extname(relPath).toLowerCase();
  if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    return {
      ok: true,
      skipped: true,
      reason: `No post-edit lint for ${ext || "extensionless"} files.`,
    };
  }

  const packageManager = detectPackageManager(root, packageJson.value);
  const hasDirectEslint = hasDependency(packageJson.value, "eslint");
  const hasLintScript = scriptNames(packageJson.value).includes("lint");
  if (!hasDirectEslint && !hasLintScript) {
    return {
      ok: true,
      skipped: true,
      reason: "No eslint dependency or lint script found in this workspace.",
    };
  }

  const normalizedPath = relPath.replace(/\\/g, "/");
  const command = hasDirectEslint
    ? execCommand(packageManager, [
        "eslint",
        normalizedPath,
        "--max-warnings",
        "0",
        "--format",
        "json",
      ])
    : runScriptCommand(packageManager, "lint");

  const [file, ...args] = command;
  if (!file) {
    return { ok: true, skipped: true, reason: "lint command could not be built." };
  }

  const result = await runWorkspaceProcess(file, args, root, {
    timeoutMs: LINT_TIMEOUT_MS,
  });
  if (result.exitCode === 0) {
    return { ok: true, skipped: false };
  }

  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const issues = parseLintOutput(combined, normalizedPath);
  if (issues.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: hasDirectEslint
        ? "eslint failed without diagnostics for the edited file."
        : "lint script failed, but no diagnostics matched the edited file.",
    };
  }

  const summary = issues
    .slice(0, 5)
    .map(
      (issue) =>
        `${normalizedPath}:${issue.line}:${issue.column} ${issue.message}${
          issue.ruleId ? ` (${issue.ruleId})` : ""
        }`,
    )
    .join("; ");

  return {
    ok: false,
    skipped: false,
    issues,
    summary,
    ...(combined.trim().length > 0 ? { rawOutput: combined.slice(0, 4_000) } : {}),
  };
}

function parseLintOutput(output: string, relPath: string): PostEditLintIssue[] {
  const jsonIssues = parseJsonLintOutput(output, relPath);
  if (jsonIssues.length > 0) return jsonIssues;
  return parseTextLintOutput(output, relPath);
}

function parseJsonLintOutput(output: string, relPath: string): PostEditLintIssue[] {
  const trimmed = output.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const files = Array.isArray(parsed) ? parsed : [parsed];
    return files.flatMap((file) => {
      if (!isRecord(file)) return [];
      const filePath = typeof file.filePath === "string" ? file.filePath.replace(/\\/g, "/") : "";
      if (!filePath.endsWith(relPath)) return [];
      const messages = Array.isArray(file.messages) ? file.messages : [];
      return messages.flatMap((message): PostEditLintIssue[] => {
        if (!isRecord(message)) return [];
        const line = typeof message.line === "number" ? message.line : 1;
        const column = typeof message.column === "number" ? message.column : 1;
        const text =
          typeof message.message === "string"
            ? message.message
            : "eslint reported an issue on the edited file.";
        const ruleId =
          typeof message.ruleId === "string" ? message.ruleId : undefined;
        return [{ line, column, message: text, ...(ruleId ? { ruleId } : {}) }];
      });
    });
  } catch {
    return [];
  }
}

function parseTextLintOutput(output: string, relPath: string): PostEditLintIssue[] {
  const basename = relPath.split("/").pop() ?? relPath;
  const issues: PostEditLintIssue[] = [];
  let currentFileMatches = false;
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
      const normalized = trimmed.replace(/\\/g, "/");
      if (normalized.endsWith(relPath) || normalized.endsWith(`/${basename}`)) {
        currentFileMatches = true;
        continue;
      }
      if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(normalized)) {
        currentFileMatches = false;
        continue;
      }
    }
    const unixMatch = trimmed.match(
      /^(?:.*[\\/])?([^:]+):(\d+):(\d+):\s*(.+?)(?:\s+\[(.+)\])?$/,
    );
    const stylishMatch = trimmed.match(
      /^\s*(\d+):(\d+)\s+(?:error|warning)\s+(.+?)(?:\s{2,}([@\w/-]+))?$/,
    );
    const match = unixMatch ?? stylishMatch;
    if (!match) continue;
    const [, filePartOrLine, lineTextOrColumn, columnTextOrMessage, messageOrRule, ruleIdOrUndefined] =
      match;
    const isUnix = unixMatch !== null;
    const filePart = isUnix ? filePartOrLine : basename;
    const lineText = isUnix ? lineTextOrColumn : filePartOrLine;
    const columnText = isUnix ? columnTextOrMessage : lineTextOrColumn;
    const message = isUnix ? messageOrRule : columnTextOrMessage;
    const ruleId = isUnix ? ruleIdOrUndefined : messageOrRule;
    if (isUnix) {
      if (!filePart?.includes(basename) && !trimmed.includes(relPath)) continue;
    } else if (!currentFileMatches) {
      continue;
    }
    issues.push({
      line: Number.parseInt(lineText, 10),
      column: Number.parseInt(columnText, 10),
      message: message.trim(),
      ...(ruleId ? { ruleId: ruleId.trim() } : {}),
    });
  }
  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
