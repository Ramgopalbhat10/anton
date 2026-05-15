import type { LanguageModelUsage, ProviderMetadata } from "ai";

export const CACHED_INPUT_TOKEN_DISPLAY_FACTOR = 0.1;

export type TokenUsageMetrics = {
  rawInputTokens?: number;
  outputTokens?: number;
  rawTotalTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  uncachedInputTokens?: number;
  effectiveInputTokens?: number;
  effectiveTokens?: number;
  providerEffectiveTokens?: number;
  cachedInputTokenDisplayFactor: number;
  source: "provider" | "estimated";
};

export type SessionTokenUsage = {
  effectiveTokens: number;
  rawTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  costUsd?: number;
  hasEffectiveMetrics: boolean;
};

export function buildTokenUsageMetrics({
  usage,
  providerMetadata,
}: {
  usage?: LanguageModelUsage;
  providerMetadata?: ProviderMetadata;
}): TokenUsageMetrics | undefined {
  const rawInputTokens = finiteNumber(usage?.inputTokens);
  const outputTokens = finiteNumber(usage?.outputTokens);
  const rawTotalTokens = finiteNumber(usage?.totalTokens);
  const cachedInputTokens = openRouterTokenCount(providerMetadata, [
    "cached_tokens",
    "cachedTokens",
    "cached_input_tokens",
    "cachedInputTokens",
    "cache_read_tokens",
    "cacheReadTokens",
  ]);
  const cacheWriteTokens = openRouterTokenCount(providerMetadata, [
    "cache_write_tokens",
    "cacheWriteTokens",
    "cache_creation_tokens",
    "cacheCreationTokens",
  ]);
  const providerEffectiveTokens = openRouterTokenCount(providerMetadata, [
    "effective_tokens",
    "effectiveTokens",
    "billable_tokens",
    "billableTokens",
    "charged_tokens",
    "chargedTokens",
  ]);
  const uncachedInputTokens =
    rawInputTokens === undefined
      ? undefined
      : Math.max(0, rawInputTokens - (cachedInputTokens ?? 0));
  const effectiveInputTokens =
    uncachedInputTokens === undefined
      ? undefined
      : uncachedInputTokens +
        (cachedInputTokens ?? 0) * CACHED_INPUT_TOKEN_DISPLAY_FACTOR;
  const estimatedEffectiveTokens =
    effectiveInputTokens === undefined && outputTokens === undefined
      ? undefined
      : (effectiveInputTokens ?? 0) + (outputTokens ?? 0);
  const effectiveTokens = providerEffectiveTokens ?? estimatedEffectiveTokens;

  if (
    rawInputTokens === undefined &&
    outputTokens === undefined &&
    rawTotalTokens === undefined &&
    cachedInputTokens === undefined &&
    cacheWriteTokens === undefined &&
    providerEffectiveTokens === undefined
  ) {
    return undefined;
  }

  return {
    ...(rawInputTokens !== undefined ? { rawInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(rawTotalTokens !== undefined ? { rawTotalTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(uncachedInputTokens !== undefined ? { uncachedInputTokens } : {}),
    ...(effectiveInputTokens !== undefined ? { effectiveInputTokens } : {}),
    ...(effectiveTokens !== undefined ? { effectiveTokens } : {}),
    ...(providerEffectiveTokens !== undefined ? { providerEffectiveTokens } : {}),
    cachedInputTokenDisplayFactor: CACHED_INPUT_TOKEN_DISPLAY_FACTOR,
    source: providerEffectiveTokens !== undefined ? "provider" : "estimated",
  };
}

export function tokenUsageFromCostMetadata(
  costMetadata: Record<string, unknown> | null | undefined,
): TokenUsageMetrics | undefined {
  const tokenUsage = isRecord(costMetadata?.tokenUsage)
    ? costMetadata.tokenUsage
    : undefined;
  if (!tokenUsage) return undefined;
  const effectiveTokens = finiteNumber(tokenUsage.effectiveTokens);
  const rawTotalTokens = finiteNumber(tokenUsage.rawTotalTokens);
  const rawInputTokens = finiteNumber(tokenUsage.rawInputTokens);
  const outputTokens = finiteNumber(tokenUsage.outputTokens);
  const cachedInputTokens = finiteNumber(tokenUsage.cachedInputTokens);
  const cacheWriteTokens = finiteNumber(tokenUsage.cacheWriteTokens);
  const providerEffectiveTokens = finiteNumber(tokenUsage.providerEffectiveTokens);
  const uncachedInputTokens = finiteNumber(tokenUsage.uncachedInputTokens);
  const effectiveInputTokens = finiteNumber(tokenUsage.effectiveInputTokens);
  if (
    effectiveTokens === undefined &&
    rawTotalTokens === undefined &&
    cachedInputTokens === undefined
  ) {
    return undefined;
  }
  return {
    ...(rawInputTokens !== undefined ? { rawInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(rawTotalTokens !== undefined ? { rawTotalTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(uncachedInputTokens !== undefined ? { uncachedInputTokens } : {}),
    ...(effectiveInputTokens !== undefined ? { effectiveInputTokens } : {}),
    ...(effectiveTokens !== undefined ? { effectiveTokens } : {}),
    ...(providerEffectiveTokens !== undefined ? { providerEffectiveTokens } : {}),
    cachedInputTokenDisplayFactor:
      finiteNumber(tokenUsage.cachedInputTokenDisplayFactor) ??
      CACHED_INPUT_TOKEN_DISPLAY_FACTOR,
    source: tokenUsage.source === "provider" ? "provider" : "estimated",
  };
}

export function openRouterCostFromMetadata(
  providerMetadata: ProviderMetadata | undefined,
): number | undefined {
  const usage = openRouterUsage(providerMetadata);
  return finiteNumber(usage?.cost);
}

function openRouterTokenCount(
  providerMetadata: ProviderMetadata | undefined,
  keys: readonly string[],
): number | undefined {
  const usage = openRouterUsage(providerMetadata);
  const promptDetails = isRecord(usage?.prompt_tokens_details)
    ? usage.prompt_tokens_details
    : undefined;
  const promptDetailsCamel = isRecord(usage?.promptTokensDetails)
    ? usage.promptTokensDetails
    : undefined;
  for (const source of [usage, promptDetails, promptDetailsCamel]) {
    if (!source) continue;
    for (const key of keys) {
      const value = finiteNumber(source[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function openRouterUsage(
  providerMetadata: ProviderMetadata | undefined,
): Record<string, unknown> | undefined {
  const openrouter = isRecord(providerMetadata?.openrouter)
    ? providerMetadata.openrouter
    : undefined;
  return isRecord(openrouter?.usage) ? openrouter.usage : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
