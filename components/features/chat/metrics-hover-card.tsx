"use client";

import type { ReactNode } from "react";
import { Coins, Cpu } from "lucide-react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import {
  formatMetricCost,
  formatMetricDuration,
  formatMetricNumber,
  type ResponseMetrics,
} from "./message-metrics";
import type { SessionTokenUsage } from "@/src/lib/token-usage";

function MetricRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  const empty = value === "-" || value === "—";
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[11.5px] text-muted-foreground/70">{label}</span>
      <span
        className={cn(
          "whitespace-nowrap font-mono text-[11.5px] tabular-nums",
          accent
            ? "text-success"
            : empty
              ? "text-muted-foreground/70"
              : "text-foreground",
        )}
      >
        {empty ? "—" : value}
      </span>
    </div>
  );
}

function MetricsHoverCardShell({
  trigger,
  headerIcon: HeaderIcon,
  headerLabel,
  children,
  footer,
}: {
  trigger: ReactNode;
  headerIcon?: typeof Cpu;
  headerLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent className="w-[280px] p-0">
        <div className="flex items-center gap-1.5 border-b border-layout-border px-3 py-2.5">
          {HeaderIcon ? (
            <HeaderIcon className="size-3 text-muted-foreground" />
          ) : null}
          <span className="truncate font-mono text-[11.5px] font-semibold">
            {headerLabel}
          </span>
        </div>
        <div className="px-3 pb-2.5 pt-1.5">{children}</div>
        {footer}
      </HoverCardContent>
    </HoverCard>
  );
}

export function ResponseMetricsHoverCard({
  metrics,
}: {
  metrics: ResponseMetrics;
}) {
  const modelName = formatModelName(metrics.model);
  return (
    <MetricsHoverCardShell
      headerIcon={Cpu}
      headerLabel={modelName}
      trigger={
        <button
          type="button"
          className="inline-flex size-[22px] items-center justify-center rounded-md bg-secondary text-foreground ring-1 ring-border transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-ring"
          aria-label="Response metrics"
        >
          <Cpu className="size-3" />
        </button>
      }
    >
      <MetricRow label="Total" value={formatMetricNumber(metrics.totalTokens)} />
      {metrics.effectiveTokens !== undefined ? (
        <MetricRow
          label="Effective"
          value={formatMetricNumber(metrics.effectiveTokens)}
        />
      ) : null}
      <MetricRow label="In" value={formatMetricNumber(metrics.inputTokens)} />
      <MetricRow label="Out" value={formatMetricNumber(metrics.outputTokens)} />
      {metrics.cachedInputTokens !== undefined ||
      metrics.cacheWriteTokens !== undefined ? (
        <>
          <MetricRow
            label="Cached"
            value={formatMetricNumber(metrics.cachedInputTokens)}
            accent={(metrics.cachedInputTokens ?? 0) > 0}
          />
          <MetricRow
            label="Write"
            value={formatMetricNumber(metrics.cacheWriteTokens)}
          />
        </>
      ) : null}
      <MetricRow label="Cost" value={formatMetricCost(metrics.costUsd)} />
      <MetricRow
        label="Duration"
        value={formatMetricDuration(metrics.durationMs)}
      />
    </MetricsHoverCardShell>
  );
}

export type SessionMetricsDisplay = "full" | "compact" | "minimal";

export function SessionMetricsHoverCard({
  tokenUsage,
  display = "full",
}: {
  tokenUsage: SessionTokenUsage;
  display?: SessionMetricsDisplay;
}) {
  const tokens = formatCompactSessionTokens(tokenUsage.effectiveTokens);
  const label =
    display === "full"
      ? `session · ${tokens} tok`
      : display === "compact"
        ? `${tokens} tok`
        : tokens;

  return (
    <MetricsHoverCardShell
      headerLabel="Session"
      trigger={
        <button
          type="button"
          className="inline-flex !h-[26px] !min-h-[26px] !max-h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2 py-0 font-mono text-[11.5px] leading-none text-muted-foreground/80 ring-1 ring-border transition-colors hover:bg-secondary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-ring"
          aria-label="Session token usage"
        >
          <Coins className="size-[11px]" aria-hidden />
          {label}
        </button>
      }
      footer={
        !tokenUsage.hasEffectiveMetrics ? (
          <p className="border-t border-layout-border px-3 py-2 text-[10px] leading-snug text-muted-foreground/70">
            Effective value falls back to raw tokens for older runs.
          </p>
        ) : undefined
      }
    >
      <MetricRow label="Raw" value={formatMetricNumber(tokenUsage.rawTokens)} />
      <MetricRow
        label="Effective"
        value={formatMetricNumber(tokenUsage.effectiveTokens)}
      />
      <MetricRow
        label="Cached"
        value={formatMetricNumber(tokenUsage.cachedInputTokens)}
        accent={(tokenUsage.cachedInputTokens ?? 0) > 0}
      />
      <MetricRow
        label="Write"
        value={
          tokenUsage.cacheWriteTokens > 0
            ? formatMetricNumber(tokenUsage.cacheWriteTokens)
            : "—"
        }
      />
      {tokenUsage.costUsd !== undefined ? (
        <MetricRow label="Cost" value={formatMetricCost(tokenUsage.costUsd)} />
      ) : null}
    </MetricsHoverCardShell>
  );
}

function formatModelName(value: string | undefined): string {
  if (!value) return "-";
  return value.split("/").at(-1) ?? value;
}

function formatCompactSessionTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
