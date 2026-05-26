"use client";

import type { ReactNode } from "react";
import { Database } from "lucide-react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import type {
  ProjectRunDetailsPromptCache,
  ProjectRunDetailsRun,
  ProjectRunDetailsStepUsage,
} from "@/src/lib/api-types";

export function stepUsageByNumber(
  stepUsage: readonly ProjectRunDetailsStepUsage[],
): Map<number, ProjectRunDetailsStepUsage> {
  return new Map(stepUsage.map((step) => [step.stepNumber, step]));
}

export function stepUsageFromCostMetadata(
  costMetadata: unknown,
): ProjectRunDetailsStepUsage[] {
  if (!isRecord(costMetadata)) return [];
  const tokenAudit = isRecord(costMetadata.tokenAudit)
    ? costMetadata.tokenAudit
    : null;
  if (!tokenAudit || !Array.isArray(tokenAudit.steps)) return [];

  return tokenAudit.steps.flatMap((step): ProjectRunDetailsStepUsage[] => {
    if (!isRecord(step)) return [];
    const stepNumber = finiteNumber(step.stepNumber);
    if (stepNumber === undefined) return [];
    return [
      {
        stepNumber,
        ...(finiteNumber(step.inputTokens) !== undefined
          ? { inputTokens: finiteNumber(step.inputTokens) }
          : {}),
        ...(finiteNumber(step.outputTokens) !== undefined
          ? { outputTokens: finiteNumber(step.outputTokens) }
          : {}),
        ...(finiteNumber(step.reasoningTokens) !== undefined
          ? { reasoningTokens: finiteNumber(step.reasoningTokens) }
          : {}),
        ...(finiteNumber(step.cachedInputTokens) !== undefined
          ? { cachedInputTokens: finiteNumber(step.cachedInputTokens) }
          : {}),
        ...(finiteNumber(step.toolCallCount) !== undefined
          ? { toolCallCount: finiteNumber(step.toolCallCount) }
          : {}),
        ...(typeof step.finishReason === "string"
          ? { finishReason: step.finishReason }
          : {}),
      },
    ];
  });
}

export function parseHarnessStepNumber(stepId: string): number | undefined {
  const match = stepId.match(/:step:(\d+)$/);
  if (!match) return undefined;
  const value = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(value) ? value : undefined;
}

export function stepCacheStatus(
  step: ProjectRunDetailsStepUsage | undefined,
): "hit" | "miss" | undefined {
  if (!step) return undefined;
  if (step.cachedInputTokens !== undefined && step.cachedInputTokens > 0) {
    return "hit";
  }
  if (step.inputTokens !== undefined && step.inputTokens > 0) return "miss";
  return undefined;
}

export function StepCacheIndicator({
  step,
  displayStepNumber,
}: {
  step: ProjectRunDetailsStepUsage | undefined;
  displayStepNumber: number;
}) {
  const status = stepCacheStatus(step);
  if (!step || status === undefined) return null;

  const inputTokens = step.inputTokens;
  const cachedTokens = step.cachedInputTokens ?? 0;
  const cachePercent =
    inputTokens !== undefined && inputTokens > 0
      ? Math.round((cachedTokens / inputTokens) * 100)
      : undefined;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex shrink-0 items-center rounded p-0.5 transition-colors",
            "hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            status === "hit"
              ? "text-emerald-400/90"
              : "text-muted-foreground/55",
          )}
          aria-label={
            status === "hit"
              ? `Step ${displayStepNumber} cache hit`
              : `Step ${displayStepNumber} cache miss`
          }
        >
          <Database className="size-3" strokeWidth={2.25} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-52 space-y-1.5 p-2.5">
        <p className="text-[10px] font-medium text-foreground/90">
          Step {displayStepNumber} ·{" "}
          <span
            className={cn(
              status === "hit" ? "text-emerald-400" : "text-muted-foreground",
            )}
          >
            cache {status}
          </span>
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
          <dt>Input</dt>
          <dd className="text-right text-foreground/85">
            {formatCompactCount(inputTokens)}
          </dd>
          <dt>Cached</dt>
          <dd className="text-right text-foreground/85">
            {cachedTokens > 0 ? formatCompactCount(cachedTokens) : "—"}
            {cachePercent !== undefined && cachedTokens > 0
              ? ` (${cachePercent}%)`
              : ""}
          </dd>
          {step.outputTokens !== undefined ? (
            <>
              <dt>Output</dt>
              <dd className="text-right text-foreground/85">
                {formatCompactCount(step.outputTokens)}
              </dd>
            </>
          ) : null}
          {step.toolCallCount !== undefined ? (
            <>
              <dt>Tools</dt>
              <dd className="text-right text-foreground/85">
                {step.toolCallCount}
              </dd>
            </>
          ) : null}
        </dl>
      </HoverCardContent>
    </HoverCard>
  );
}

export function UsageStatGrid({
  run,
  usage,
}: {
  run: ProjectRunDetailsRun;
  usage: ProjectRunDetailsRun["tokenUsage"];
}) {
  const stats = [
    {
      label: "Raw total",
      value: formatCompactCount(run.rawTotalTokens ?? run.totalTokens),
    },
    {
      label: "Effective",
      value: formatCompactCount(run.effectiveTokens ?? usage?.effectiveTokens),
    },
    {
      label: "Cached read",
      value: formatCompactCount(usage?.cachedInputTokens),
      accent: (usage?.cachedInputTokens ?? 0) > 0,
    },
    {
      label: "Cache write",
      value: formatCompactCount(usage?.cacheWriteTokens),
    },
    {
      label: "Reasoning",
      value: formatCompactCount(usage?.reasoningTokens),
    },
    {
      label: "Provider billed",
      value: formatCompactCount(usage?.providerEffectiveTokens),
    },
  ].filter((stat) => stat.value !== "—");

  if (stats.length === 0) return null;

  return (
    <section className="rounded-md border border-border/40 bg-background/20 p-2">
      <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Token totals
      </h4>
      <div className="flex gap-1.5">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="min-w-0 flex-1 rounded bg-secondary/30 px-1.5 py-1 text-center ring-1 ring-border/30"
          >
            <div
              className={cn(
                "font-mono text-[11px] font-medium tabular-nums",
                stat.accent ? "text-emerald-400/90" : "text-foreground/90",
              )}
            >
              {stat.value}
            </div>
            <div className="truncate text-[9px] text-muted-foreground">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PromptCacheSection({
  promptCache,
}: {
  promptCache: ProjectRunDetailsPromptCache;
}) {
  const hashRows = [
    ["System", promptCache.systemPromptHash],
    ["Tools", promptCache.toolSchemaHash],
    ["Prefix", promptCache.messagePrefixHash],
    ["Workspace", promptCache.workspaceContextHash],
  ] as const;

  return (
    <section className="rounded-md border border-border/40 bg-background/20 p-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h4 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Prompt cache
        </h4>
        {promptCache.cacheHitRate !== undefined ? (
          <span className="font-mono text-[10px] tabular-nums text-emerald-400/85">
            {(promptCache.cacheHitRate * 100).toFixed(1)}% hit
          </span>
        ) : null}
      </div>
      <div className="mb-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        <span className="truncate">{promptCache.modelId}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{promptCache.providerId}</span>
        {promptCache.cachedInputTokens !== undefined ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span>{formatCompactCount(promptCache.cachedInputTokens)} cached</span>
          </>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[9px] text-muted-foreground/80">
        {hashRows.map(([label, hash]) => (
          <div key={label} className="flex min-w-0 gap-1">
            <span className="shrink-0 text-muted-foreground/60">{label}</span>
            <span className="truncate">{hash}</span>
          </div>
        ))}
      </div>
      {promptCache.intentionalSegmentTransition ? (
        <div className="mt-1.5 border-t border-border/30 pt-1.5 text-[9px] leading-snug text-sky-200/80">
          {promptCache.intentionalSegmentTransition}
        </div>
      ) : null}
          {promptCache.cacheBreakReasons.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5 border-t border-border/30 pt-1.5 text-[9px] leading-snug text-sky-200/75">
              {promptCache.cacheBreakReasons.map((reason) => (
                <li key={reason} className="line-clamp-2">
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
          {promptCache.likelyCacheMissReasons.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 border-t border-border/30 pt-1.5 text-[9px] leading-snug text-amber-200/75">
          {promptCache.likelyCacheMissReasons.map((reason) => (
            <li key={reason} className="line-clamp-2">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function StepUsageTable({
  stepUsage,
}: {
  stepUsage: readonly ProjectRunDetailsStepUsage[];
}) {
  if (stepUsage.length === 0) return null;

  return (
    <section className="rounded-md border border-border/40 bg-background/20 p-2">
      <h4 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Per-step usage
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-left text-[9px] uppercase tracking-wide text-muted-foreground/70">
              <th className="pb-0.5 pr-2 font-medium">Step</th>
              <th className="pb-0.5 pr-2 text-right font-medium">In</th>
              <th className="pb-0.5 pr-2 text-right font-medium">Cached</th>
              <th className="pb-0.5 pr-2 text-right font-medium">Out</th>
              <th className="pb-0.5 text-right font-medium">Tools</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums text-muted-foreground">
            {stepUsage.map((step) => {
              const status = stepCacheStatus(step);
              return (
                <tr
                  key={step.stepNumber}
                  className="border-t border-border/20 text-foreground/85"
                >
                  <td className="py-0.5 pr-2">
                    <span className="inline-flex items-center gap-1">
                      {step.stepNumber + 1}
                      {status !== undefined ? (
                        <Database
                          className={cn(
                            "size-2.5",
                            status === "hit"
                              ? "text-emerald-400/80"
                              : "text-muted-foreground/40",
                          )}
                          strokeWidth={2.25}
                        />
                      ) : null}
                    </span>
                  </td>
                  <td className="py-0.5 pr-2 text-right">
                    {formatCompactCount(step.inputTokens)}
                  </td>
                  <td
                    className={cn(
                      "py-0.5 pr-2 text-right",
                      (step.cachedInputTokens ?? 0) > 0 && "text-emerald-400/85",
                    )}
                  >
                    {(step.cachedInputTokens ?? 0) > 0
                      ? formatCompactCount(step.cachedInputTokens)
                      : "—"}
                  </td>
                  <td className="py-0.5 pr-2 text-right">
                    {formatCompactCount(step.outputTokens)}
                  </td>
                  <td className="py-0.5 text-right">
                    {step.toolCallCount ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function UsageSectionShell({
  title,
  trailing,
  children,
  className,
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-md border border-border/40 bg-background/20 p-2",
        className,
      )}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h4 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
        {trailing}
      </div>
      {children}
    </section>
  );
}

export function formatCompactCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1000) {
    const compact = value / 1000;
    return compact >= 10
      ? `${Math.round(compact)}K`
      : `${compact.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return value.toLocaleString();
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
