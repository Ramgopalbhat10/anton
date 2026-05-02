import type { ToolSet } from "ai";

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

export const RISK_CATEGORIES = [
  "read-only",
  "write",
  "delete",
  "network",
  "package-install",
  "git",
  "long-running-process",
  "external-integration",
] as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export type RiskClassification = {
  categories: readonly RiskCategory[];
  requiresApproval: boolean;
};

export type RiskLevel = "safe" | "risky";

const READ_ONLY = classify(["read-only"], false);

export const NATIVE_TOOL_RISK_CLASSIFICATIONS = {
  read_file: READ_ONLY,
  grep: READ_ONLY,
  glob: READ_ONLY,
  write_file: classify(["write"], true),
  bash: classify(
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
  ),
  list_memory: READ_ONLY,
  remember: classify(["write"], true),
  update_memory: classify(["write"], true),
  forget_memory: classify(["delete"], true),
  list_skills: READ_ONLY,
  read_skill: READ_ONLY,
  delegate_task: classify(["read-only", "external-integration"], false),
} as const satisfies Record<string, RiskClassification>;

export const NATIVE_TOOL_RISK_LEVELS = Object.fromEntries(
  Object.entries(NATIVE_TOOL_RISK_CLASSIFICATIONS).map(([name, risk]) => [
    name,
    risk.requiresApproval ? "risky" : "safe",
  ]),
) as Record<keyof typeof NATIVE_TOOL_RISK_CLASSIFICATIONS, RiskLevel>;

export const RISK_LEVELS: Record<string, RiskLevel> = NATIVE_TOOL_RISK_LEVELS;
export const RISK_CLASSIFICATIONS: Record<string, RiskClassification> =
  NATIVE_TOOL_RISK_CLASSIFICATIONS;

type ToolWithApproval = ToolSet[string] & {
  needsApproval?: boolean;
};

export function applyNativeToolPermissionPolicy<TTools extends ToolSet>(
  tools: TTools,
  mode: PermissionMode = "auto-review",
): TTools {
  return Object.fromEntries(
    Object.entries(tools).map(([name, toolValue]) => {
      const risk = RISK_CLASSIFICATIONS[name];
      if (!risk) {
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

      if (risk.requiresApproval) {
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

export function classifyBashCommand(command: string): RiskClassification {
  const normalized = command.trim();
  if (!normalized) return READ_ONLY;

  const categories = new Set<RiskCategory>();

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

  return classify(
    [...categories],
    [...categories].some((category) => category !== "read-only"),
  );
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

function classify(
  categories: readonly RiskCategory[],
  requiresApproval: boolean,
): RiskClassification {
  return { categories, requiresApproval };
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
