"use client";

import type { ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  Cpu,
  DollarSign,
  Hash,
} from "lucide-react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  formatMetricCost,
  formatMetricDuration,
  formatMetricNumber,
  type ResponseMetrics,
} from "./message-metrics";
import type { SessionTokenUsage } from "@/src/lib/token-usage";

function MetricRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Hash;
  label: string;
  value: number | undefined;
}) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <Icon className="size-3" />
      <span>{label}</span>
      <span className="ml-auto whitespace-nowrap font-mono text-foreground">
        {formatMetricNumber(value)}
      </span>
    </div>
  );
}

function MetricsHoverCardShell({
  trigger,
  headerIcon: HeaderIcon,
  headerLabel,
  children,
}: {
  trigger: ReactNode;
  headerIcon?: typeof Cpu;
  headerLabel: string;
  children: ReactNode;
}) {
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent className="w-64 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
          {HeaderIcon ? <HeaderIcon className="size-3" /> : null}
          {headerLabel}
        </div>
        <div className="space-y-1.5 text-[10px]">{children}</div>
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
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground focus:outline-none"
          aria-label="Response metrics"
        >
          <Cpu className="size-3" />
        </button>
      }
    >
      <MetricRow icon={Hash} label="Total" value={metrics.totalTokens} />
      {metrics.effectiveTokens !== undefined ? (
        <MetricRow
          icon={Hash}
          label="Effective"
          value={metrics.effectiveTokens}
        />
      ) : null}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5">
          <ArrowDownToLine className="size-3 text-muted-foreground" />
          <span className="text-muted-foreground">In</span>
          <span className="ml-auto whitespace-nowrap font-mono text-foreground">
            {formatMetricNumber(metrics.inputTokens)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowUpFromLine className="size-3 text-muted-foreground" />
          <span className="text-muted-foreground">Out</span>
          <span className="ml-auto whitespace-nowrap font-mono text-foreground">
            {formatMetricNumber(metrics.outputTokens)}
          </span>
        </div>
      </div>
      {metrics.cachedInputTokens !== undefined ||
      metrics.cacheWriteTokens !== undefined ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <div className="flex items-center gap-1.5">
            <Hash className="size-3 text-muted-foreground" />
            <span className="text-muted-foreground">Cached</span>
            <span className="ml-auto whitespace-nowrap font-mono text-foreground">
              {formatMetricNumber(metrics.cachedInputTokens)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Hash className="size-3 text-muted-foreground" />
            <span className="text-muted-foreground">Write</span>
            <span className="ml-auto whitespace-nowrap font-mono text-foreground">
              {formatMetricNumber(metrics.cacheWriteTokens)}
            </span>
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5">
          <DollarSign className="size-3 text-muted-foreground" />
          <span className="text-muted-foreground">Cost</span>
          <span className="ml-auto whitespace-nowrap font-mono text-foreground">
            {formatMetricCost(metrics.costUsd)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="size-3 text-muted-foreground" />
          <span className="text-muted-foreground">Duration</span>
          <span className="ml-auto whitespace-nowrap font-mono text-foreground">
            {formatMetricDuration(metrics.durationMs)}
          </span>
        </div>
      </div>
    </MetricsHoverCardShell>
  );
}

export function SessionMetricsHoverCard({
  tokenUsage,
}: {
  tokenUsage: SessionTokenUsage;
}) {
  return (
    <MetricsHoverCardShell
      headerLabel="Session"
      trigger={
        <button
          type="button"
          className="inline-flex h-5 items-center gap-1 rounded-md bg-secondary px-1.5 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Session token usage"
        >
          <span
            className="size-1.5 rounded-full bg-muted-foreground/50"
            aria-hidden
          />
          <span className="text-muted-foreground/70">session</span>
          {formatCompactSessionTokens(tokenUsage.effectiveTokens)}
          <span className="text-muted-foreground/70">tok</span>
        </button>
      }
    >
      <MetricRow icon={Hash} label="Raw" value={tokenUsage.rawTokens} />
      <MetricRow
        icon={Hash}
        label="Effective"
        value={tokenUsage.effectiveTokens}
      />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5">
          <Hash className="size-3 text-muted-foreground" />
          <span className="text-muted-foreground">Cached</span>
          <span className="ml-auto whitespace-nowrap font-mono text-foreground">
            {formatMetricNumber(tokenUsage.cachedInputTokens)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Hash className="size-3 text-muted-foreground" />
          <span className="text-muted-foreground">Write</span>
          <span className="ml-auto whitespace-nowrap font-mono text-foreground">
            {tokenUsage.cacheWriteTokens > 0
              ? formatMetricNumber(tokenUsage.cacheWriteTokens)
              : "-"}
          </span>
        </div>
      </div>
      {tokenUsage.costUsd !== undefined ? (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <DollarSign className="size-3" />
          <span>Cost</span>
          <span className="ml-auto whitespace-nowrap font-mono text-foreground">
            {formatMetricCost(tokenUsage.costUsd)}
          </span>
        </div>
      ) : null}
      {!tokenUsage.hasEffectiveMetrics ? (
        <p className="border-t border-border/40 pt-1.5 text-[9px] leading-snug text-muted-foreground/80">
          Effective value falls back to raw tokens for older runs.
        </p>
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
