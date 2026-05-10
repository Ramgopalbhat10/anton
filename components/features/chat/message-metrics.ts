import {
  getMessageRunDurationMs,
  getRunData,
  getRunDataList,
  type AntonRunData,
  type AntonUIMessage,
} from "@/src/lib/trace";

export type ResponseMetrics = {
  model?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
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
    costUsd:
      aggregate.costUsd ??
      readNumber(metadata, "costUsd") ??
      readNumber(metadata, "cost") ??
      readNumber(run, "costUsd") ??
      readNumber(run, "cost"),
  };
}

function aggregateRunMetrics(runs: AntonRunData[]): ResponseMetrics {
  return {
    inputTokens: sumDefined(runs.map((run) => run.inputTokens)),
    outputTokens: sumDefined(runs.map((run) => run.outputTokens)),
    totalTokens: sumDefined(runs.map((run) => run.totalTokens)),
    costUsd: sumDefined(runs.map((run) => run.costUsd)),
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
