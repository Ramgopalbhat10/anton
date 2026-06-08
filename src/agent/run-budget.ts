import type { AgentRunProfile } from "./loop";

export type RunBudget = {
  profile: AgentRunProfile;
  maxSteps: number;
  maxOutputTokens: number;
  maxInputTokens: number;
  maxInputBytes: number;
  maxTotalTokens: number;
  maxEffectiveTokens: number;
  maxRawInputTokensPerStep: number;
  rawTokenSanityCap: number;
  maxCostUsd: number;
  priorRunContextChars: number;
  workspaceContextChars: number;
  latestUserMaxBytes: number;
};

const BYTES_PER_TOKEN_ESTIMATE = 4;

const RUN_BUDGETS = {
  "pure-chat": {
    maxSteps: 1,
    maxOutputTokens: 4_096,
    maxInputTokens: 24_000,
    maxTotalTokens: 32_000,
    maxCostUsd: 0.02,
    priorRunContextChars: 0,
    workspaceContextChars: 0,
  },
  ask: {
    maxSteps: 6,
    maxOutputTokens: 4_096,
    maxInputTokens: 32_000,
    maxTotalTokens: 48_000,
    maxCostUsd: 0.05,
    priorRunContextChars: 4_000,
    workspaceContextChars: 4_000,
  },
  plan: {
    maxSteps: 16,
    maxOutputTokens: 4_096,
    maxInputTokens: 48_000,
    maxTotalTokens: 64_000,
    maxCostUsd: 0.08,
    priorRunContextChars: 5_000,
    workspaceContextChars: 5_000,
  },
  "accepted-plan-simple": {
    maxSteps: 16,
    maxOutputTokens: 4_096,
    maxInputTokens: 32_000,
    maxTotalTokens: 48_000,
    maxCostUsd: 0.08,
    priorRunContextChars: 3_000,
    workspaceContextChars: 3_000,
  },
  "accepted-plan-general": {
    maxSteps: 32,
    maxOutputTokens: 8_192,
    maxInputTokens: 64_000,
    maxTotalTokens: 96_000,
    maxCostUsd: 0.25,
    priorRunContextChars: 6_000,
    workspaceContextChars: 6_000,
  },
  "command-run": {
    maxSteps: 6,
    maxOutputTokens: 4_096,
    maxInputTokens: 24_000,
    maxTotalTokens: 40_000,
    maxCostUsd: 0.05,
    priorRunContextChars: 2_500,
    workspaceContextChars: 2_500,
  },
  "general-chat": {
    maxSteps: 32,
    maxOutputTokens: 8_192,
    maxInputTokens: 64_000,
    maxTotalTokens: 96_000,
    maxCostUsd: 0.25,
    priorRunContextChars: 6_000,
    workspaceContextChars: 6_000,
  },
  "localized-edit": {
    maxSteps: 8,
    maxOutputTokens: 2_048,
    maxInputTokens: 24_000,
    maxTotalTokens: 40_000,
    maxCostUsd: 0.05,
    priorRunContextChars: 1_500,
    workspaceContextChars: 1_500,
  },
  "single-file-edit": {
    maxSteps: 5,
    maxOutputTokens: 2_048,
    maxInputTokens: 20_000,
    maxTotalTokens: 32_000,
    maxCostUsd: 0.04,
    priorRunContextChars: 0,
    workspaceContextChars: 0,
  },
  "approval-continuation": {
    maxSteps: 32,
    maxOutputTokens: 8_192,
    maxInputTokens: 64_000,
    maxTotalTokens: 96_000,
    maxCostUsd: 0.25,
    priorRunContextChars: 4_000,
    workspaceContextChars: 4_000,
  },
} as const satisfies Record<
  AgentRunProfile,
  Omit<
    RunBudget,
    | "profile"
    | "maxInputBytes"
    | "latestUserMaxBytes"
    | "maxEffectiveTokens"
    | "maxRawInputTokensPerStep"
    | "rawTokenSanityCap"
  >
>;

const DEFAULT_EFFECTIVE_RATIO = 0.55;
const DEFAULT_RAW_SANITY_MULTIPLIER = 4;

export function budgetForProfile(profile: AgentRunProfile): RunBudget {
  const budget = RUN_BUDGETS[profile];
  const maxInputBytes = budget.maxInputTokens * BYTES_PER_TOKEN_ESTIMATE;
  return {
    profile,
    ...budget,
    maxEffectiveTokens: Math.round(
      budget.maxTotalTokens * DEFAULT_EFFECTIVE_RATIO,
    ),
    maxRawInputTokensPerStep: budget.maxInputTokens,
    rawTokenSanityCap: budget.maxTotalTokens * DEFAULT_RAW_SANITY_MULTIPLIER,
    maxInputBytes,
    latestUserMaxBytes: Math.floor(maxInputBytes * 0.8),
  };
}
