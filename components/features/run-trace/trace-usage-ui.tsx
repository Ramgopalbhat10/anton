"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Database } from "lucide-react";

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
              ? "text-success"
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
      <HoverCardContent align="start" className="w-[230px] p-0">
        <p className="px-3 pb-[5px] pt-[9px] text-xs">
          <span className="font-semibold text-foreground">
            Step {displayStepNumber}
          </span>{" "}
          <span
            className={cn(
              status === "hit" ? "text-success" : "text-muted-foreground/70",
            )}
          >
            · cache {status}
          </span>
        </p>
        <dl className="px-3 pb-2.5 pt-0.5">
          <StepUsageStatRow label="Input" value={formatCompactCount(inputTokens)} />
          <StepUsageStatRow
            label="Cached"
            value={
              cachedTokens > 0
                ? `${formatCompactCount(cachedTokens)}${
                    cachePercent !== undefined ? ` (${cachePercent}%)` : ""
                  }`
                : "—"
            }
            accent={cachedTokens > 0}
          />
          {step.outputTokens !== undefined ? (
            <StepUsageStatRow
              label="Output"
              value={formatCompactCount(step.outputTokens)}
            />
          ) : null}
          {step.toolCallCount !== undefined ? (
            <StepUsageStatRow label="Tools" value={String(step.toolCallCount)} />
          ) : null}
        </dl>
      </HoverCardContent>
    </HoverCard>
  );
}

function StepUsageStatRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <dt className="text-[11.5px] text-muted-foreground/70">{label}</dt>
      <dd
        className={cn(
          "font-mono text-[11.5px] tabular-nums",
          accent
            ? "text-success"
            : value === "—"
              ? "text-muted-foreground/70"
              : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function UsageStatGrid({
  run,
  usage,
}: {
  run: ProjectRunDetailsRun;
  usage: ProjectRunDetailsRun["tokenUsage"];
}) {
  const stats: {
    label: string;
    value: string;
    tone?: "success" | "thought";
  }[] = [
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
      ...((usage?.cachedInputTokens ?? 0) > 0
        ? { tone: "success" as const }
        : {}),
    },
    {
      label: "Reasoning",
      value: formatCompactCount(usage?.reasoningTokens),
      ...((usage?.reasoningTokens ?? 0) > 0
        ? { tone: "thought" as const }
        : {}),
    },
  ].filter((stat) => stat.value !== "—");

  if (stats.length === 0) return null;

  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/65">
        Token totals
      </h4>
      <div className="grid grid-cols-2 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col items-center gap-0.5 rounded-lg border border-border bg-card px-2.5 py-[9px]"
          >
            <span
              className={cn(
                "font-mono text-sm font-semibold tabular-nums",
                stat.tone === "success"
                  ? "text-success"
                  : stat.tone === "thought"
                    ? "text-violet-400"
                    : "text-foreground",
              )}
            >
              {stat.value}
            </span>
            <span className="text-[10.5px] text-muted-foreground/70">
              {stat.label}
            </span>
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
    <section className="border-t border-layout-border pt-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/65">
          Prompt cache
        </h4>
        {promptCache.cacheHitRate !== undefined ? (
          <span className="font-mono text-[11.5px] font-semibold tabular-nums text-success">
            {(promptCache.cacheHitRate * 100).toFixed(1)}% hit
          </span>
        ) : null}
      </div>
      <div className="mb-2 truncate font-mono text-[10.5px] text-muted-foreground">
        {promptCache.modelId}
        <span className="text-muted-foreground/50"> · </span>
        {promptCache.providerId}
        {promptCache.cachedInputTokens !== undefined ? (
          <>
            <span className="text-muted-foreground/50"> · </span>
            {formatCompactCount(promptCache.cachedInputTokens)} cached
          </>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
        {hashRows.map(([label, hash]) => (
          <div key={label} className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-muted-foreground/65">{label}</span>
            <span className="truncate font-mono text-muted-foreground">
              {hash}
            </span>
          </div>
        ))}
      </div>
      {promptCache.intentionalSegmentTransition ? (
        <p className="mt-2 text-[10.5px] leading-[1.5] text-(--accent-muted)">
          {promptCache.intentionalSegmentTransition}
        </p>
      ) : null}
      {promptCache.cacheBreakReasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[10.5px] leading-[1.5] text-(--accent-muted)">
          {promptCache.cacheBreakReasons.map((reason) => (
            <li key={reason} className="line-clamp-2">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
      {promptCache.likelyCacheMissReasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[10.5px] leading-[1.5] text-warning/80">
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
  const [expanded, setExpanded] = useState(false);
  if (stepUsage.length === 0) return null;

  const visible = expanded
    ? stepUsage
    : stepUsage.slice(0, STEP_USAGE_PREVIEW_LIMIT);
  const hidden = stepUsage.length - visible.length;

  return (
    <section className="border-t border-layout-border pt-3">
      <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/65">
        Per-step usage
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground/65">
              <th className="pb-1 pr-2 font-semibold">Step</th>
              <th className="pb-1 pr-2 text-right font-semibold">In</th>
              <th className="pb-1 pr-2 text-right font-semibold">Cached</th>
              <th className="pb-1 pr-2 text-right font-semibold">Out</th>
              <th className="pb-1 text-right font-semibold">Tools</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums text-muted-foreground">
            {visible.map((step) => {
              const status = stepCacheStatus(step);
              return (
                <tr key={step.stepNumber}>
                  <td className="py-[3px] pr-2">
                    <span className="inline-flex items-center gap-1.5 text-foreground">
                      {step.stepNumber + 1}
                      {status !== undefined ? (
                        <Database
                          className={cn(
                            "size-[9px]",
                            status === "hit"
                              ? "text-success"
                              : "text-muted-foreground/40",
                          )}
                          strokeWidth={2.25}
                        />
                      ) : null}
                    </span>
                  </td>
                  <td className="py-[3px] pr-2 text-right">
                    {formatCompactCount(step.inputTokens)}
                  </td>
                  <td
                    className={cn(
                      "py-[3px] pr-2 text-right",
                      (step.cachedInputTokens ?? 0) > 0 && "text-success",
                    )}
                  >
                    {(step.cachedInputTokens ?? 0) > 0
                      ? formatCompactCount(step.cachedInputTokens)
                      : "—"}
                  </td>
                  <td className="py-[3px] pr-2 text-right">
                    {formatCompactCount(step.outputTokens)}
                  </td>
                  <td className="py-[3px] text-right">
                    {step.toolCallCount ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {stepUsage.length > STEP_USAGE_PREVIEW_LIMIT ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? (
            <ChevronUp className="size-[11px] text-muted-foreground/65" />
          ) : (
            <ChevronDown className="size-[11px] text-muted-foreground/65" />
          )}
          {expanded ? "Show fewer steps" : `Show ${hidden} more steps`}
        </button>
      ) : null}
    </section>
  );
}

const STEP_USAGE_PREVIEW_LIMIT = 8;

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
      className={cn("border-t border-layout-border pt-3", className)}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/65">
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
