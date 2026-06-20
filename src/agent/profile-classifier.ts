import type { AgentRunMode, AgentRunProfile } from "./loop";
import type { AntonUIMessage } from "@/src/lib/trace";
import { isRunDataPart } from "@/src/lib/trace";

const BROAD_SCOPE_PATTERNS = [
  /\bentire app\b/,
  /\bwhole app\b/,
  /\barchitecture\b/,
  /\bmultiple modules\b/,
  /\bacross modules\b/,
  /\bmigration\b/,
  /\bimplement roadmap\b/,
  /\blarge refactor\b/,
  /\bfull refactor\b/,
  /\brefactor the entire\b/,
  /\bimplement the plan\b/,
  /\bapply plan\b/,
  /\bapply the plan\b/,
  /\bimplement plan\b/,
] as const;

const IMPLEMENTATION_PATTERNS = [
  /\bimplement\b/,
  /\bfix\b/,
  /\badd\b/,
  /\bwire\b/,
  /\bhook up\b/,
  /\bintegrate\b/,
  /\bbuild\b/,
  /\bcreat(?:e|ing)\b/,
  /\benable\b/,
  /\bsupport\b/,
  /\bmake\b.+\bwork\b/,
] as const;

const LOCALIZED_SCOPE_PATTERNS = [
  /\bminimal\b/,
  /\bsmall\b/,
  /\bsurgical\b/,
  /\bone file\b/,
  /\bsingle file\b/,
  /\bcomponent\b/,
  /\bpage\b/,
  /\broute\b/,
  /\bfunction\b/,
  /\bmethod\b/,
  /\bclass\b/,
  /\bsearch bar\b/,
  /\bsidebar\b/,
  /\b[a-z0-9_-]+\.(?:ts|tsx|js|jsx|css|scss|md|json)\b/,
] as const;

const LOCALIZED_EDIT_TOOLS = [
  "read_file",
  "grep",
  "glob",
  "stat",
  "edit_text",
  "replace_text",
  "replace_lines",
  "multi_replace_text",
  "edit_file",
  "verify",
  "git_status",
] as const;

export type LocalizedEditToolName = (typeof LOCALIZED_EDIT_TOOLS)[number];

export function localizedEditToolNames(): readonly LocalizedEditToolName[] {
  return LOCALIZED_EDIT_TOOLS;
}

export function isBroadScopeRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  return BROAD_SCOPE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isImplementationRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return IMPLEMENTATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isLocalizedImplementationRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || !isImplementationRequest(normalized)) return false;
  return LOCALIZED_SCOPE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isCommandRunRequest(latestText: string): boolean {
  return (
    /^(run|execute|rerun|use bash|use terminal)\b/.test(latestText) ||
    /`(?:git|gh|pnpm|npm|yarn|bun|cat|ls|rg|grep|find)\b[^`]*`/.test(latestText) ||
    /\bgh\s+(?:pr|issue)\b/.test(latestText) ||
    /^(?:commit|push|pull|fetch|checkout|switch|branch|merge|rebase)\b/.test(
      latestText,
    ) ||
    /\b(?:can you|please|retry|try|go ahead|now)\b.*\b(?:commit|committing|push|pushing|pull|fetch|checkout|switch|branch|merge|rebase)\b/.test(
      latestText,
    ) ||
    /\b(?:commit|committing)\b.*\b(?:push|pushing|pr|pull request)\b/.test(
      latestText,
    ) ||
    /\b(?:push|pushing)\b.*\b(?:pr|pull request)\b/.test(
      latestText,
    ) ||
    /\b(?:creat(?:e|ing)|open(?:ing)?|retry|rerun|try(?:ing)?)\b.*\b(?:pr|pull request|issue)\b/.test(
      latestText,
    ) ||
    /\b(?:pr|pull request|issue)\b.*\b(?:creat(?:e|ing)|open(?:ing)?|retry|rerun|try(?:ing)?)\b/.test(
      latestText,
    ) ||
    /\b(?:discard|revert|restore)\b.*\b(?:changes|repo|repository|working tree|workspace)\b/.test(
      latestText,
    ) ||
    /\b(?:clean|stash)\b.*\b(?:repo|repository|working tree|workspace)\b/.test(
      latestText,
    ) ||
    /\bkeep\b.*\b(?:repo|repository|working tree|workspace)\b.*\bclean\b/.test(
      latestText,
    )
  );
}

export function classifyAgentProfile(latestUserText: string): AgentRunProfile {
  const normalized = latestUserText.trim().toLowerCase();
  if (normalized === "implement plan") return "accepted-plan-simple";
  if (
    normalized === "implement the plan" ||
    normalized === "apply plan" ||
    normalized === "apply the plan"
  ) {
    return "accepted-plan-general";
  }
  if (isCommandRunRequest(normalized)) return "command-run";
  if (isBroadScopeRequest(normalized)) return "general-chat";
  if (isLocalizedImplementationRequest(normalized)) return "localized-edit";
  if (isImplementationRequest(normalized)) return "general-chat";
  return "general-chat";
}

export function classifyRunProfile(
  mode: AgentRunMode,
  latestUserText: string,
): AgentRunProfile {
  if (mode === "chat") return "pure-chat";
  if (mode === "ask") return "ask";
  if (mode === "plan") return "plan";
  return classifyAgentProfile(latestUserText);
}

export function classifyRunProfileWithContext(
  mode: AgentRunMode,
  latestUserText: string,
  recentContextText: string | undefined,
): AgentRunProfile {
  const profile = classifyRunProfile(mode, latestUserText);
  if (
    mode !== "agent" ||
    profile !== "ask" ||
    !recentContextText ||
    !isRetryFollowUp(latestUserText)
  ) {
    return profile;
  }

  const retryProfile = classifyAgentProfile(`${recentContextText}\n${latestUserText}`);
  return retryProfile === "ask" ? profile : retryProfile;
}

export function executionProfileFromCostMetadata(
  costMetadata: unknown,
): AgentRunProfile | undefined {
  if (!isRecord(costMetadata)) return undefined;
  const execution = isRecord(costMetadata.execution)
    ? costMetadata.execution
    : undefined;
  const profile = execution?.profile;
  return isAgentRunProfile(profile) ? profile : undefined;
}

export function effectiveProfileFromCostMetadata(
  costMetadata: unknown,
): AgentRunProfile | undefined {
  if (!isRecord(costMetadata)) return undefined;
  const execution = isRecord(costMetadata.execution)
    ? costMetadata.execution
    : undefined;
  const effectiveProfile = execution?.effectiveProfile;
  return isAgentRunProfile(effectiveProfile) ? effectiveProfile : undefined;
}

export function executionModelFromCostMetadata(
  costMetadata: unknown,
): string | undefined {
  if (!isRecord(costMetadata)) return undefined;
  const execution = isRecord(costMetadata.execution)
    ? costMetadata.execution
    : undefined;
  const model = execution?.model;
  return typeof model === "string" && model.length > 0 ? model : undefined;
}

export function runIdFromAssistantMessage(
  message: AntonUIMessage | undefined,
): string | undefined {
  if (!message || message.role !== "assistant") return undefined;
  if (typeof message.metadata?.runId === "string") {
    return message.metadata.runId;
  }
  const runPart = message.parts.find(isRunDataPart);
  return runPart?.data.runId;
}

function isAgentRunProfile(value: unknown): value is AgentRunProfile {
  return (
    value === "pure-chat" ||
    value === "ask" ||
    value === "plan" ||
    value === "accepted-plan-simple" ||
    value === "accepted-plan-general" ||
    value === "command-run" ||
    value === "general-chat" ||
    value === "localized-edit" ||
    value === "single-file-edit" ||
    value === "approval-continuation"
  );
}

function isRetryFollowUp(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /\b(?:again|now|retry|try|login|logged in|authenticated)\b/.test(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
