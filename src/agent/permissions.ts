import type { ToolSet } from "ai";

// Permission gate helpers for tool execution.
//
// Permission modes:
// - "default": all native tools require user approval (most conservative).
// - "auto-review": safe tools auto-run, risky tools require approval (default).
// - "full-access": no native tools require approval.
//
// `needsApproval: true` causes `streamText` to emit a `tool-approval-request`
// part; the client UI then approves or denies via `addToolApprovalResponse`
// and the harness resumes the loop.

export type RiskLevel = "safe" | "risky";

export type PermissionMode = "default" | "auto-review" | "full-access";

export const NATIVE_TOOL_RISK_LEVELS = {
  read_file: "safe",
  grep: "safe",
  glob: "safe",
  write_file: "risky",
  bash: "risky",
  list_memory: "safe",
  remember: "risky",
  update_memory: "risky",
  forget_memory: "risky",
  list_skills: "safe",
  read_skill: "safe",
  delegate_task: "safe",
} as const satisfies Record<string, RiskLevel>;

export const RISK_LEVELS: Record<string, RiskLevel> = NATIVE_TOOL_RISK_LEVELS;

type ToolWithApproval = ToolSet[string] & {
  needsApproval?: boolean;
};

export function applyNativeToolPermissionPolicy<TTools extends ToolSet>(
  tools: TTools,
  mode: PermissionMode = "auto-review",
): TTools {
  return Object.fromEntries(
    Object.entries(tools).map(([name, toolValue]) => {
      const risk = RISK_LEVELS[name];
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

      if (risk === "risky") {
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
