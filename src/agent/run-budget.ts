import {
  stepCountIs,
  type ProviderMetadata,
  type StopCondition,
  type ToolSet,
} from "ai";

import { openRouterCostFromMetadata } from "@/src/lib/token-usage";
import type { AgentRunProfile } from "./loop";

export type RunBudget = {
  profile: AgentRunProfile;
  maxSteps: number;
  maxOutputTokens: number;
  maxInputTokens: number;
  maxInputBytes: number;
  maxTotalTokens: number;
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
  Omit<RunBudget, "profile" | "maxInputBytes" | "latestUserMaxBytes">
>;

export function budgetForProfile(profile: AgentRunProfile): RunBudget {
  const budget = RUN_BUDGETS[profile];
  const maxInputBytes = budget.maxInputTokens * BYTES_PER_TOKEN_ESTIMATE;
  return {
    profile,
    ...budget,
    maxInputBytes,
    latestUserMaxBytes: Math.floor(maxInputBytes * 0.8),
  };
}

export function capRunBudget(
  budget: RunBudget,
  maxStepsCap: number | null | undefined,
): RunBudget {
  if (maxStepsCap === null || maxStepsCap === undefined) return budget;
  return {
    ...budget,
    maxSteps: Math.min(budget.maxSteps, maxStepsCap),
  };
}

export function applyTokenBudgetMultiplier(
  budget: RunBudget,
  multiplier: number,
): RunBudget {
  const scale = Math.max(1, Math.floor(multiplier));
  return {
    ...budget,
    maxTotalTokens: budget.maxTotalTokens * scale,
    maxCostUsd: budget.maxCostUsd * scale,
  };
}

export const TOKEN_BUDGET_MULTIPLIER_OPTIONS = [2, 3, 5] as const;

export type TokenBudgetMultiplierOption =
  (typeof TOKEN_BUDGET_MULTIPLIER_OPTIONS)[number];

export function availableTokenBudgetMultipliers(
  currentMultiplier: number,
): TokenBudgetMultiplierOption[] {
  return TOKEN_BUDGET_MULTIPLIER_OPTIONS.filter(
    (option) => option > currentMultiplier,
  );
}

export function tokenBudgetStopCondition(
  maxTotalTokens: number,
  priorTokensUsed = 0,
): StopCondition<ToolSet> {
  return ({ steps }) => {
    return priorTokensUsed + totalStepTokens(steps) >= maxTotalTokens;
  };
}

export function costBudgetStopCondition(
  maxCostUsd: number,
  priorCostUsd = 0,
): StopCondition<ToolSet> {
  return ({ steps }) => {
    const segmentCost = totalStepCostUsd(steps);
    return (
      segmentCost !== undefined && priorCostUsd + segmentCost >= maxCostUsd
    );
  };
}

export function remainingStepsStopCondition(
  maxSteps: number,
  priorStepCount: number,
): StopCondition<ToolSet> {
  const remaining = Math.max(1, maxSteps - priorStepCount);
  return stepCountIs(remaining);
}

function totalStepCostUsd(
  steps: readonly { providerMetadata?: ProviderMetadata }[],
): number | undefined {
  const stepProviderMetadata = steps.flatMap((step) =>
    step.providerMetadata ? [step.providerMetadata] : [],
  );
  return openRouterCostFromMetadata(undefined, stepProviderMetadata);
}

function totalStepTokens(
  steps: readonly { usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number } }[],
): number {
  return steps.reduce((sum, step) => {
    const total = finiteNumber(step.usage?.totalTokens);
    if (total !== undefined) return sum + total;
    return (
      sum +
      (finiteNumber(step.usage?.inputTokens) ?? 0) +
      (finiteNumber(step.usage?.outputTokens) ?? 0)
    );
  }, 0);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
