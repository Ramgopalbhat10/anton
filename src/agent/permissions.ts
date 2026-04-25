// Permission gate helpers for tool execution.
//
// "safe" tools (`read_file`, `grep`, `glob`) run automatically. "risky" tools
// (`write_file`, `bash`) are tagged with `needsApproval: true` on the tool
// definition itself, which causes `streamText` to emit a
// `tool-approval-request` part; the client UI then approves or denies via
// `addToolApprovalResponse` and the harness resumes the loop.

export type RiskLevel = "safe" | "risky";

export const RISK_LEVELS: Record<string, RiskLevel> = {
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
};

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
