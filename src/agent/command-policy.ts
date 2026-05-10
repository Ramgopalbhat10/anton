import path from "node:path";

import type { ToolRiskCategory } from "./permissions";

export type BashCommandClassification = {
  categories: readonly ToolRiskCategory[];
  forbidden: boolean;
  reason: string;
};

export type BashCommandPolicyDecision =
  | {
      allowed: true;
      classification: BashCommandClassification;
    }
  | {
      allowed: false;
      classification: BashCommandClassification;
      reason: string;
    };

const RISK_CATEGORY_ORDER: readonly ToolRiskCategory[] = [
  "read-only",
  "write",
  "delete",
  "network",
  "package-install",
  "git",
  "long-running-process",
  "external-integration",
];

const READ_ONLY_COMMANDS = new Set([
  "awk",
  "basename",
  "cat",
  "dirname",
  "du",
  "echo",
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

const BASH_ENV_ALLOWLIST = new Set([
  "CI",
  "COLORTERM",
  "ComSpec",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "NO_COLOR",
  "Path",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SystemRoot",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "USERPROFILE",
  "WINDIR",
  "windir",
]);

const FORBIDDEN_COMMAND_PATTERNS: readonly RegExp[] = [
  /(^|\s|;|&&|\|\|)\s*sudo(\s|$)/,
  /(^|\s|;|&&|\|\|)\s*su(\s|$)/,
];

const SECRET_FILE_RE =
  /(^|[\s/\\])(?:\.env(?:\.[^/\\\s]+)?|id_rsa|id_dsa|id_ecdsa|id_ed25519|[^/\\\s]*(?:token|secret|credential|private[-_]?key)[^/\\\s]*)(?:$|\s)/i;
const SECRET_NAME_RE =
  /\b(?:api[_-]?key|authorization|bearer|client[_-]?secret|credential|github[_-]?app[_-]?private[_-]?key|openrouter[_-]?api[_-]?key|password|private[_-]?key|secret|token)\b/i;

export function classifyBashCommand(command: string): BashCommandClassification {
  const normalized = command.trim();
  if (!normalized) {
    return {
      categories: ["read-only"],
      forbidden: false,
      reason: "empty command",
    };
  }

  const forbidden = forbiddenPattern(normalized);
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
  if (hasExternalIntegrationPattern(normalized)) categories.add("external-integration");

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

export function evaluateBashCommandPolicy(
  command: string,
  options: { workspaceRoot?: string } = {},
): BashCommandPolicyDecision {
  const classification = classifyBashCommand(command);
  if (classification.forbidden) {
    return { allowed: false, classification, reason: classification.reason };
  }

  const violation = firstPolicyViolation(command, options.workspaceRoot);
  if (violation) {
    return {
      allowed: false,
      classification: { ...classification, forbidden: true, reason: violation },
      reason: violation,
    };
  }

  return { allowed: true, classification };
}

export function buildBashEnvironment(
  source: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (!isAllowedEnvironmentKey(key)) continue;
    env[key] = value;
  }
  return env;
}

function firstPolicyViolation(
  command: string,
  workspaceRoot: string | undefined,
): string | null {
  const normalized = command.trim();
  if (!normalized) return null;
  if (printsEnvironment(normalized)) {
    return "refuses commands that print the shell environment";
  }
  if (readsSecretTarget(normalized)) {
    return "refuses commands that read or search likely secret files or values";
  }
  return (
    destructiveTargetViolation(normalized) ??
    absolutePathViolation(normalized) ??
    redirectionViolation(normalized, workspaceRoot)
  );
}

function forbiddenPattern(command: string): RegExp | null {
  for (const re of FORBIDDEN_COMMAND_PATTERNS) {
    if (re.test(command)) return re;
  }
  return null;
}

function printsEnvironment(command: string): boolean {
  return splitCommandSegments(command).some((segment) =>
    /^(?:env|printenv|set)(?:\s|$)/.test(segment),
  );
}

function readsSecretTarget(command: string): boolean {
  return splitCommandSegments(command).some((segment) => {
    if (!/^(?:cat|grep|head|tail|less|more|rg|sed|awk|type)\b/.test(segment)) {
      return false;
    }
    return SECRET_FILE_RE.test(`${segment} `) || SECRET_NAME_RE.test(segment);
  });
}

function destructiveTargetViolation(command: string): string | null {
  for (const segment of splitCommandSegments(command)) {
    if (!/^(?:rm|unlink|rmdir)\b/.test(segment)) continue;
    const targets = shellWords(segment).slice(1).filter((token) => !token.startsWith("-"));
    if (
      targets.some((token) =>
        ["/", "\\", "~", ".", "..", "*", "./*", ".\\*"].includes(token),
      )
    ) {
      return "refuses destructive filesystem commands aimed at root, home, parent, current directory, or workspace-wide wildcards";
    }
    if (targets.some((token) => token.startsWith("../") || token.startsWith("..\\"))) {
      return "refuses destructive filesystem commands targeting parent directories";
    }
  }
  if (/\bgit\s+(?:clean|reset\s+--hard)\b/.test(command)) {
    return "refuses destructive git cleanup/reset commands";
  }
  return null;
}

function absolutePathViolation(command: string): string | null {
  for (const token of shellWords(command)) {
    if (isUrl(token) || token.startsWith("-")) continue;
    if (isAbsoluteFilesystemPath(token)) {
      return "refuses absolute filesystem paths in shell commands";
    }
  }
  return null;
}

function redirectionViolation(
  command: string,
  workspaceRoot: string | undefined,
): string | null {
  const redirections = command.matchAll(/(?:^|[^<>])>{1,2}(?![>&])\s*([^;&|)\s]+)/g);
  for (const match of redirections) {
    const target = stripQuotes(match[1] ?? "");
    if (!target || target === "/dev/null") continue;
    if (target.startsWith("../") || target.startsWith("..\\")) {
      return "refuses shell redirection outside the workspace";
    }
    if (isAbsoluteFilesystemPath(target)) {
      if (!workspaceRoot) return "refuses absolute shell redirection targets";
      if (!isInside(path.resolve(target), path.resolve(workspaceRoot))) {
        return "refuses shell redirection outside the workspace";
      }
    }
  }
  return null;
}

function shellWords(command: string): string[] {
  const words = command.match(/"[^"]*"|'[^']*'|[^\s;&|()]+/g) ?? [];
  return words.map(stripQuotes);
}

function splitCommandSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function isAbsoluteFilesystemPath(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\")
  );
}

function isUrl(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isAllowedEnvironmentKey(key: string): boolean {
  return BASH_ENV_ALLOWLIST.has(key) || key.startsWith("LC_");
}

function orderedRiskCategories(
  categories: ReadonlySet<ToolRiskCategory>,
): ToolRiskCategory[] {
  return RISK_CATEGORY_ORDER.filter((category) => categories.has(category));
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
  const segments = splitCommandSegments(command);
  if (segments.length === 0) return true;

  return segments.every((segment) => {
    const executable = segment.match(/^([A-Za-z0-9_.-]+)/)?.[1];
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
