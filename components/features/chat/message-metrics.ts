import {
  getMessageRunDurationMs,
  getRunData,
  getRunDataList,
  type AntonRunData,
  type AntonUIMessage,
} from "@/src/lib/trace";
import {
  tokenUsageFromCostMetadata,
  type SessionTokenUsage,
} from "@/src/lib/token-usage";

export type ResponseMetrics = {
  model?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  uncachedInputTokens?: number;
  effectiveTokens?: number;
  costUsd?: number;
};

export function messageMetrics(message: AntonUIMessage): ResponseMetrics {
  const metadata = message.metadata;
  const runs = getRunDataList(message);
  const run = getRunData(message);
  const aggregate = aggregateRunMetrics(runs);
  return {
    model: run?.model ?? metadata?.model,
    durationMs: getMessageRunDurationMs(message) ?? aggregate.durationMs,
    inputTokens:
      aggregate.inputTokens ??
      readNumber(metadata, "inputTokens") ??
      readNumber(run, "inputTokens"),
    outputTokens:
      aggregate.outputTokens ??
      readNumber(metadata, "outputTokens") ??
      readNumber(run, "outputTokens"),
    totalTokens:
      aggregate.totalTokens ??
      readNumber(metadata, "totalTokens") ??
      readNumber(run, "totalTokens"),
    cachedInputTokens: aggregate.cachedInputTokens,
    cacheWriteTokens: aggregate.cacheWriteTokens,
    uncachedInputTokens: aggregate.uncachedInputTokens,
    effectiveTokens: aggregate.effectiveTokens,
    costUsd:
      aggregate.costUsd ??
      readNumber(metadata, "costUsd") ??
      readNumber(metadata, "cost") ??
      readNumber(run, "costUsd") ??
      readNumber(run, "cost"),
  };
}

function aggregateRunMetrics(runs: AntonRunData[]): ResponseMetrics {
  const tokenUsage = runs.map((run) => tokenUsageFromCostMetadata(run.costMetadata));
  return {
    inputTokens: sumDefined(runs.map((run) => run.inputTokens)),
    outputTokens: sumDefined(runs.map((run) => run.outputTokens)),
    totalTokens: sumDefined(runs.map((run) => run.totalTokens)),
    cachedInputTokens: sumDefined(
      tokenUsage.map((usage) => usage?.cachedInputTokens),
    ),
    cacheWriteTokens: sumDefined(
      tokenUsage.map((usage) => usage?.cacheWriteTokens),
    ),
    uncachedInputTokens: sumDefined(
      tokenUsage.map((usage) => usage?.uncachedInputTokens),
    ),
    effectiveTokens: sumDefined(tokenUsage.map((usage) => usage?.effectiveTokens)),
    costUsd: sumDefined(runs.map((run) => run.costUsd)),
  };
}

export function sessionTokenUsage(
  messages: AntonUIMessage[],
  fallbackRawTokens: number,
): SessionTokenUsage {
  const runs = messages.flatMap((message) => getRunDataList(message));
  let rawTokens = 0;
  let effectiveTokens = 0;
  let cachedInputTokens = 0;
  let cacheWriteTokens = 0;
  let costUsd = 0;
  let hasCost = false;
  let hasRuns = false;
  let hasEffectiveMetrics = false;

  for (const run of runs) {
    const usage = tokenUsageFromCostMetadata(run.costMetadata);
    const runRawTokens = run.totalTokens ?? usage?.rawTotalTokens ?? 0;
    rawTokens += runRawTokens;
    effectiveTokens += usage?.effectiveTokens ?? runRawTokens;
    cachedInputTokens += usage?.cachedInputTokens ?? 0;
    cacheWriteTokens += usage?.cacheWriteTokens ?? 0;
    if (run.costUsd !== undefined) {
      costUsd += run.costUsd;
      hasCost = true;
    }
    hasRuns = true;
    if (usage?.effectiveTokens !== undefined) hasEffectiveMetrics = true;
  }

  if (!hasRuns) {
    rawTokens = fallbackRawTokens;
    effectiveTokens = fallbackRawTokens;
  }

  return {
    effectiveTokens: Math.round(effectiveTokens),
    rawTokens: Math.round(rawTokens),
    cachedInputTokens: Math.round(cachedInputTokens),
    cacheWriteTokens: Math.round(cacheWriteTokens),
    ...(hasCost ? { costUsd } : {}),
    hasEffectiveMetrics,
  };
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  let total = 0;
  let hasValue = false;
  for (const value of values) {
    if (!isFiniteNumber(value)) continue;
    total += value;
    hasValue = true;
  }
  return hasValue ? total : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return isFiniteNumber(entry) ? entry : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatMetricNumber(value: number | undefined): string {
  return isFiniteNumber(value) ? new Intl.NumberFormat().format(value) : "-";
}

export function formatMetricCost(value: number | undefined): string {
  if (!isFiniteNumber(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "symbol",
    maximumFractionDigits: 4,
  })
    .format(value)
    .replace("US$", "$");
}

export function formatMetricDuration(value: number | undefined): string {
  if (!isFiniteNumber(value)) return "-";
  const seconds = Math.max(0, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}
