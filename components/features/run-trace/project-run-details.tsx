"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Hash,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { Markdown } from "@/components/features/chat/markdown";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/shared/disclosure";
import { ErrorBanner } from "@/components/shared/feedback-states";
import { TerminalOutput } from "@/components/features/run-trace/terminal-output";
import { BashTerminalFooter } from "@/components/features/run-trace/bash-terminal";
import {
  ToolDetailCard,
  ToolDetailFooter,
  ToolDetailSection,
} from "@/components/features/run-trace/tool-detail-card";
import type { BashOutput } from "@/components/features/run-trace/terminal-utils";
import {
  formatDuration,
  groupTimelineItemsByStep,
  harnessStepDisplayNumber,
  runIdFromEventId,
  type TimelineStepGroup,
} from "@/components/features/run-trace/trace-data";
import {
  StatusPill,
  TraceExpandPanel,
  TraceThreadChildren,
  TraceThreadHeaderRow,
  TraceThreadNode,
  TraceThreadRoot,
  TraceTimelineRow,
  timelineEventMeta,
} from "@/components/features/run-trace/trace-timeline-ui";
import {
  formatCompactCount,
  parseHarnessStepNumber,
  PromptCacheSection,
  StepCacheIndicator,
  stepUsageByNumber,
  StepUsageTable,
  UsageStatGrid,
  UsageSectionShell,
} from "@/components/features/run-trace/trace-usage-ui";
import {
  contextCompositionSections,
  contextCompositionTotalTokens,
} from "@/src/lib/context-composition";
import { cn } from "@/lib/utils";
import type {
  ProjectRunDetailsApproval,
  ProjectRunDetailsEvent,
  ProjectRunDetailsStepUsage,
  ProjectRunDetailsSummary,
  ProjectRunDetailsToolCall,
} from "@/src/lib/api-types";
import { getJson } from "@/src/lib/client-fetch";

const RUN_TABS = [
  { value: "usage", label: "Usage" },
  { value: "trace", label: "Trace" },
  { value: "context", label: "Context" },
] as const;

export function ProjectRunDetails({
  projectId,
  runId,
  refreshToken,
}: {
  projectId: string;
  runId: string;
  refreshToken: number;
}) {
  const [details, setDetails] = useState<ProjectRunDetailsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("trace");
  const [copied, setCopied] = useState(false);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJson<{ details: ProjectRunDetailsSummary }>(
        `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`,
      );
      setDetails(data.details);
    } catch (err) {
      setDetails(null);
      setError(
        err instanceof Error ? err.message : "Failed to load run details",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, runId]);

  useEffect(() => {
    // Details load after the panel opens; parent key remounts on run changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchDetails();
  }, [fetchDetails, refreshToken]);

  if (loading && !details) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin text-info" />
        Loading run details...
      </div>
    );
  }

  if (error && !details) {
    return (
      <div className="mt-3 space-y-2">
        <ErrorBanner message={error} />
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => void fetchDetails()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!details) return null;

  const { run, events, toolCalls, approvals, context } = details;
  const traceEventCount = events.filter(
    (event) =>
      event.kind !== "approval" && !isStaleTokenBudgetTraceEvent(event),
  ).length;

  const copyRunSummary = async () => {
    try {
      await navigator.clipboard.writeText(buildRunSummaryText(details));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-3 space-y-3">
      {error ? (
        <div className="space-y-2">
          <ErrorBanner message={error} />
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => void fetchDetails()}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <RunMetaStrip
        run={run}
        segmentCount={details.segmentCount}
        copied={copied}
        onCopy={() => void copyRunSummary()}
      />

      <div className="min-w-0 space-y-3">
        <div className="flex w-full gap-0.5 rounded-lg bg-input p-[3px]">
          {RUN_TABS.map((tab) => {
            const active = activeTab === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-md py-[5px] text-xs transition-colors",
                  active
                    ? "border border-border bg-secondary font-semibold text-foreground"
                    : "border border-transparent font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {tab.value === "trace" && traceEventCount > 0 ? (
                  <span className="tabular-nums opacity-70">
                    {traceEventCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {activeTab === "usage" ? (
          <TokenUsagePanel run={run} />
        ) : activeTab === "trace" ? (
          traceEventCount === 0 ? (
            <EmptyHint>No events recorded.</EmptyHint>
          ) : (
            <TraceTimeline
              run={run}
              segmentCount={details.segmentCount}
              events={events}
              toolCalls={toolCalls}
              approvals={approvals}
              stepUsage={run.stepUsage ?? []}
            />
          )
        ) : context ? (
          <ContextPanel context={context} />
        ) : (
          <EmptyHint>No context summary persisted for this run.</EmptyHint>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <RefreshCw className="size-3 animate-spin" />
          Refreshing...
        </div>
      ) : null}
    </div>
  );
}

function RunMetaStrip({
  run,
  segmentCount,
  copied,
  onCopy,
}: {
  run: ProjectRunDetailsSummary["run"];
  segmentCount?: number;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
      {run.provider ? (
        <MetaChip accent="primary">{run.provider}</MetaChip>
      ) : null}
      {run.finishReason ? (
        <MetaChip accent="muted">finish: {run.finishReason}</MetaChip>
      ) : null}
      {run.stepCount !== null ? (
        <MetaChip accent="muted">
          {run.stepCount} steps
          {segmentCount && segmentCount > 1 ? ` · ${segmentCount} segments` : ""}
        </MetaChip>
      ) : null}
      {run.profile ? (
        <MetaChip accent="muted">profile: {run.profile}</MetaChip>
      ) : null}
      {run.loopGuardCount !== null && run.loopGuardCount !== undefined && run.loopGuardCount > 0 ? (
        <MetaChip accent="muted">guards: {run.loopGuardCount}</MetaChip>
      ) : null}
      {run.cacheHitRate !== null && run.cacheHitRate !== undefined ? (
        <MetaChip accent="muted">
          cache: {(run.cacheHitRate * 100).toFixed(0)}%
        </MetaChip>
      ) : null}
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="ml-auto h-6 gap-1 px-2 text-[10px] text-muted-foreground"
        onClick={onCopy}
      >
        {copied ? (
          <Check className="size-3 text-success" />
        ) : (
          <Copy className="size-3" />
        )}
        {copied ? "Copied" : "Copy summary"}
      </Button>
    </div>
  );
}

function MetaChip({
  children,
  accent = "default",
}: {
  children: ReactNode;
  accent?: "default" | "muted" | "primary";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px]",
        accent === "primary"
          ? "border-primary/40 bg-primary/10 text-primary"
          : accent === "default"
            ? "border-border bg-secondary text-foreground/85"
            : "border-border bg-input text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function TraceTimeline({
  run,
  segmentCount,
  events,
  toolCalls,
  approvals,
  stepUsage,
}: {
  run: ProjectRunDetailsSummary["run"];
  segmentCount?: number;
  events: ProjectRunDetailsEvent[];
  toolCalls: ProjectRunDetailsToolCall[];
  approvals: ProjectRunDetailsApproval[];
  stepUsage: readonly ProjectRunDetailsStepUsage[];
}) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const stepUsageMap = stepUsageByNumber(stepUsage);
  const displayEvents = events.filter(
    (event) =>
      event.kind !== "approval" && !isStaleTokenBudgetTraceEvent(event),
  );

  const runGroups = buildStatusTraceRunGroups(displayEvents, run, segmentCount);
  const runMeta = timelineEventMeta("progress", run.status === "error" ? "error" : "completed");
  const stepMeta = timelineEventMeta("step", "completed");

  return (
    <TraceThreadRoot className="space-y-2">
      {runGroups.map((group) => (
        <TraceThreadNode key={group.runId}>
          <TraceThreadHeaderRow
            icon={Layers}
            iconClass={runMeta.iconClass}
            label={group.label}
            durationMs={group.durationMs}
            status={run.status === "error" ? "error" : "completed"}
          />
          <TraceThreadChildren>
            {group.steps.map((step) => {
              const harnessStepNumber = parseHarnessStepNumber(step.id);
              const stepMetrics =
                harnessStepNumber !== undefined
                  ? stepUsageMap.get(harnessStepNumber)
                  : undefined;
              const displayStepNumber =
                harnessStepNumber !== undefined
                  ? harnessStepDisplayNumber(harnessStepNumber)
                  : undefined;

              return (
              <TraceThreadNode key={step.id}>
                <TraceThreadHeaderRow
                  icon={Hash}
                  iconClass={stepMeta.iconClass}
                  label={step.label}
                  labelSuffix={
                    displayStepNumber !== undefined ? (
                      <StepCacheIndicator
                        step={stepMetrics}
                        displayStepNumber={displayStepNumber}
                      />
                    ) : undefined
                  }
                  durationMs={step.durationMs}
                  subdued
                />
                {step.items.length > 0 ? (
                  <TraceThreadChildren>
                    {step.items.map((event) => {
                      const toolCall = findToolCallForEvent(
                        event,
                        toolCalls,
                        group.runId,
                      );
                      const approval = toolCall
                        ? findApprovalForToolCall(toolCall, approvals)
                        : undefined;
                      const expandable =
                        (event.kind === "tool" && toolCall !== undefined) ||
                        (event.kind === "reasoning" &&
                          Boolean(event.summary?.trim()));
                      const expanded = expandedEventId === event.id;

                      return (
                        <TraceThreadNode key={event.id}>
                          <TraceTimelineRow
                            kind={event.kind}
                            status={event.status}
                            label={event.label}
                            durationMs={event.durationMs}
                            expandable={expandable}
                            expanded={expanded}
                            summary={
                              !expandable ? (event.summary ?? undefined) : undefined
                            }
                            onToggle={
                              expandable
                                ? () =>
                                    setExpandedEventId((current) =>
                                      current === event.id ? null : event.id,
                                    )
                                : undefined
                            }
                          >
                            {expandable && expanded && toolCall ? (
                              <ToolCallExpandPanel
                                toolCall={toolCall}
                                approval={approval}
                              />
                            ) : expandable &&
                              expanded &&
                              event.kind === "reasoning" &&
                              event.summary ? (
                              <TraceExpandPanel scrollable>
                                <pre className="font-mono text-[10px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
                                  {event.summary}
                                </pre>
                              </TraceExpandPanel>
                            ) : null}
                          </TraceTimelineRow>
                        </TraceThreadNode>
                      );
                    })}
                  </TraceThreadChildren>
                ) : null}
              </TraceThreadNode>
            );
            })}
          </TraceThreadChildren>
        </TraceThreadNode>
      ))}
    </TraceThreadRoot>
  );
}

type StatusTraceTimelineEvent = Omit<ProjectRunDetailsEvent, "durationMs"> & {
  durationMs?: number;
};

function buildStatusTraceRunGroups(
  events: ProjectRunDetailsEvent[],
  run: ProjectRunDetailsSummary["run"],
  segmentCount?: number,
): Array<{
  runId: string;
  label: string;
  durationMs?: number;
  steps: TimelineStepGroup<StatusTraceTimelineEvent>[];
}> {
  const byRunId = new Map<string, ProjectRunDetailsEvent[]>();
  for (const event of events) {
    const id = runIdFromEventId(event.id);
    const bucket = byRunId.get(id) ?? [];
    bucket.push(event);
    byRunId.set(id, bucket);
  }

  const runIds = Array.from(byRunId.keys());
  const segmentTotal = Math.max(segmentCount ?? 1, runIds.length);

  return runIds.map((runId, index) => {
    const segmentEvents = byRunId.get(runId) ?? [];
    const segmentLabel =
      segmentTotal > 1
        ? `Segment ${index + 1}/${segmentTotal}${index > 0 ? " · continued" : ""}`
        : "Run";
    const finishLabel =
      index === runIds.length - 1 && run.finishReason
        ? run.finishReason.replace(/_/g, " ")
        : undefined;
    const label = [segmentLabel, finishLabel]
      .filter((part): part is string => part !== undefined)
      .join(" · ");

    return {
      runId,
      label,
      durationMs:
        index === runIds.length - 1 ? (run.durationMs ?? undefined) : undefined,
      steps: groupTimelineItemsByStep<StatusTraceTimelineEvent>(
        segmentEvents.map((event) => ({
          ...event,
          durationMs: statusEventDurationMs(event),
          startedAt: event.startedAt,
        })),
      ),
    };
  });
}

function statusEventDurationMs(
  event: ProjectRunDetailsEvent,
): number | undefined {
  if (event.durationMs !== null) return event.durationMs;
  return event.status === "running" ? undefined : 0;
}

function PermissionLabel({ label }: { label: string }) {
  return (
    <span className="rounded bg-secondary/60 px-1 py-px font-mono text-[9px] text-muted-foreground ring-1 ring-border/50">
      {label}
    </span>
  );
}

function ToolCallExpandPanel({
  toolCall,
  approval,
}: {
  toolCall: ProjectRunDetailsToolCall;
  approval: ProjectRunDetailsApproval | undefined;
}) {
  const errored = toolCall.status === "error";
  const denied = toolCall.status === "denied";
  const stepNumber =
    toolCall.stepNumber !== null
      ? harnessStepDisplayNumber(toolCall.stepNumber)
      : undefined;
  const bashParsed =
    toolCall.toolName === "bash" ? bashOutputFromToolCall(toolCall) : undefined;
  const showStatusRow =
    Boolean(toolCall.permissionLabel) ||
    toolCall.status !== "completed" ||
    toolCall.approvalDecision === "pending" ||
    toolCall.approvalDecision === "denied";
  const extraRiskCategories =
    approval?.riskCategories.filter(
      (category) => category !== toolCall.permissionLabel,
    ) ?? [];

  return (
    <ToolDetailCard
      toolName={toolCall.toolName}
      step={stepNumber}
      failed={errored}
      denied={denied}
      copyText={toolCallCopyText(toolCall, bashParsed)}
      footer={toolCallFooter(toolCall, bashParsed)}
    >
      {showStatusRow ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {toolCall.permissionLabel ? (
            <PermissionLabel label={toolCall.permissionLabel} />
          ) : null}
          {toolCall.status !== "completed" ? (
            <StatusPill status={toolCall.status} />
          ) : null}
          {toolCall.approvalDecision === "pending" ||
          toolCall.approvalDecision === "denied" ? (
            <StatusPill status={toolCall.approvalDecision} />
          ) : null}
        </div>
      ) : null}

      {approval ? (
        <div className="space-y-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <ShieldCheck className="size-3 shrink-0 text-info" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/85">
              {approval.title}
            </span>
            {approval.decision === "pending" || approval.decision === "denied" ? (
              <StatusPill status={approval.decision} />
            ) : null}
          </div>
          <p className="break-words text-[10.5px] leading-snug text-muted-foreground">
            {approval.summary}
          </p>
          {extraRiskCategories.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {extraRiskCategories.map((category) => (
                <span
                  key={category}
                  className="rounded bg-warning/10 px-1.5 py-px font-mono text-[9px] text-warning ring-1 ring-warning/20"
                >
                  {category}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {toolCall.toolName === "bash" && toolCall.inputSummary ? (
        <TerminalOutput
          command={toolCall.inputSummary}
          output={bashParsed ?? {}}
          variant="sections"
          includeFooter={false}
        />
      ) : (
        <ToolCallIoBlocks toolCall={toolCall} />
      )}
    </ToolDetailCard>
  );
}

function ToolCallIoBlocks({ toolCall }: { toolCall: ProjectRunDetailsToolCall }) {
  const outputText =
    toolCall.outputSummary && toolCall.outputSummary !== toolCall.error
      ? toolCall.outputSummary
      : undefined;

  return (
    <>
      {toolCall.inputSummary ? (
        <ToolDetailSection label="Input" scrollable>
          <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.65] text-muted-foreground">
            {toolCall.inputSummary}
          </pre>
        </ToolDetailSection>
      ) : null}
      {outputText ? (
        <ToolDetailSection label="Output" scrollable>
          <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.65] text-muted-foreground">
            {outputText}
          </pre>
        </ToolDetailSection>
      ) : null}
      {toolCall.error ? (
        <ToolDetailSection label="Error" tone="error" scrollable>
          <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.65] text-destructive/90">
            {toolCall.error}
          </pre>
        </ToolDetailSection>
      ) : null}
    </>
  );
}

function toolCallCopyText(
  toolCall: ProjectRunDetailsToolCall,
  bashParsed: BashOutput | undefined,
): string | undefined {
  if (toolCall.toolName === "bash") {
    const parts: string[] = [];
    if (toolCall.inputSummary) parts.push(`$ ${toolCall.inputSummary}`);
    if (bashParsed?.stdout) parts.push(bashParsed.stdout);
    if (bashParsed?.stderr) parts.push(bashParsed.stderr);
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }
  const parts = [
    toolCall.inputSummary,
    toolCall.outputSummary,
    toolCall.error,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function toolCallFooter(
  toolCall: ProjectRunDetailsToolCall,
  bashParsed: BashOutput | undefined,
): ReactNode {
  if (toolCall.toolName === "bash") {
    return <BashTerminalFooter {...bashParsed} />;
  }
  if (toolCall.status === "error" && toolCall.error) {
    return (
      <ToolDetailFooter>
        <span className="font-mono text-[11px] font-semibold text-destructive">
          {toolCall.error}
        </span>
      </ToolDetailFooter>
    );
  }
  return null;
}

function bashOutputFromToolCall(
  toolCall: ProjectRunDetailsToolCall,
): BashOutput {
  const failedReason = parseFailedReason(
    toolCall.outputSummary ?? toolCall.error ?? undefined,
  );
  const stdout =
    toolCall.outputSummary &&
    toolCall.outputSummary !== toolCall.error &&
    failedReason === undefined
      ? toolCall.outputSummary
      : undefined;
  const stderr =
    toolCall.error &&
    toolCall.error !== failedReason &&
    !isFailedReasonLabel(toolCall.error)
      ? toolCall.error
      : undefined;

  return {
    ...(stdout ? { stdout } : {}),
    ...(stderr ? { stderr } : {}),
    exitCode: toolCall.exitCode,
    ...(failedReason === "timeout" ? { timedOut: true, failedReason } : {}),
    ...(failedReason && failedReason !== "timeout" ? { failedReason } : {}),
  };
}

function parseFailedReason(
  value: string | undefined,
): BashOutput["failedReason"] {
  if (!value) return undefined;
  if (value === "timeout" || value === "killed" || value === "max_buffer") {
    return value;
  }
  if (value === "error") return "error";
  return undefined;
}

function isFailedReasonLabel(value: string): boolean {
  return (
    value === "timeout" ||
    value === "killed" ||
    value === "max_buffer" ||
    value === "error"
  );
}

function findToolCallForEvent(
  event: Pick<ProjectRunDetailsEvent, "toolCallId">,
  toolCalls: ProjectRunDetailsToolCall[],
  runId: string,
): ProjectRunDetailsToolCall | undefined {
  if (!event.toolCallId) return undefined;
  return (
    toolCalls.find((call) => call.toolCallId === event.toolCallId) ??
    toolCalls.find((call) => call.id === `${runId}:tool:${event.toolCallId}`) ??
    toolCalls.find((call) => call.id.endsWith(`:tool:${event.toolCallId}`))
  );
}

function isStaleTokenBudgetTraceEvent(event: ProjectRunDetailsEvent): boolean {
  return (
    event.kind === "progress" &&
    event.label === "Token budget reached" &&
    event.status === "waiting"
  );
}

function findApprovalForToolCall(
  toolCall: ProjectRunDetailsToolCall,
  approvals: ProjectRunDetailsApproval[],
): ProjectRunDetailsApproval | undefined {
  return approvals.find((approval) => approval.toolCallId === toolCall.id);
}

function TokenUsagePanel({
  run,
}: {
  run: ProjectRunDetailsSummary["run"];
}) {
  const usage = run.tokenUsage;
  const composition = run.contextComposition;
  const promptCache = run.promptCache;
  const stepUsage = run.stepUsage ?? [];
  const sections = composition
    ? contextCompositionSections(composition)
    : [];
  const compositionTotal = composition
    ? contextCompositionTotalTokens(composition)
    : 0;
  const providerInput = run.inputTokens ?? usage?.rawInputTokens;

  return (
    <div className="space-y-3">
      <UsageStatGrid run={run} usage={usage} />

      {promptCache ? <PromptCacheSection promptCache={promptCache} /> : null}

      {stepUsage.length > 0 ? <StepUsageTable stepUsage={stepUsage} /> : null}

      {sections.length > 0 ? (
        <UsageSectionShell
          title="Context breakdown"
          trailing={
            <span className="font-mono text-[11.5px] font-semibold tabular-nums text-foreground">
              ~{formatCompactCount(compositionTotal)}
            </span>
          }
        >
          {compositionTotal > 0 ? (
            <div className="mb-2.5 flex gap-0.5">
              {sections.map((section) => (
                <div
                  key={section.key}
                  className={cn(
                    "h-2 rounded-sm",
                    contextSectionColor(section.key),
                  )}
                  style={{
                    width: `${(section.tokens / compositionTotal) * 100}%`,
                  }}
                  title={`${section.label}: ${formatCompactCount(section.tokens)}`}
                />
              ))}
            </div>
          ) : null}

          <ul className="space-y-[5px]">
            {sections.map((section) => (
              <li
                key={section.key}
                className="flex min-w-0 items-center gap-2 text-[11.5px]"
              >
                <span
                  className={cn(
                    "size-[7px] shrink-0 rounded-full",
                    contextSectionColor(section.key),
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {section.label}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground">
                  {formatCompactCount(section.tokens)}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-2.5 text-[10px] leading-[1.5] text-muted-foreground/65">
            Estimated at run start · provider input{" "}
            {formatCount(providerInput)}
            {run.stepCount !== null ? ` · ${run.stepCount} steps` : ""}
          </p>
        </UsageSectionShell>
      ) : (
        <EmptyHint>
          Context breakdown is available for new runs. Older runs only store
          provider totals.
        </EmptyHint>
      )}
    </div>
  );
}

function contextSectionColor(key: string): string {
  switch (key) {
    case "system":
      return "bg-zinc-400";
    case "tools":
      return "bg-violet-400";
    case "memory":
      return "bg-success";
    case "skills":
      return "bg-warning";
    case "mcp":
      return "bg-pink-500";
    case "profile":
      return "bg-info";
    case "prior-context":
      return "bg-fuchsia-400";
    case "conversation":
      return "bg-primary";
    default:
      return "bg-muted-foreground/50";
  }
}

function ContextPanel({
  context,
}: {
  context: NonNullable<ProjectRunDetailsSummary["context"]>;
}) {
  const parsed = parseContextSummary(context.summary);
  const visibleFacts = dedupeContextFacts(
    context.facts,
    context.summary,
    parsed.finalAnswer,
  );
  const statusLine =
    parsed.metaLines.find((line) => line.startsWith("Run status:")) ??
    parsed.metaLines[0];
  const errored = statusLine?.toLowerCase().includes("error") ?? false;

  if (!statusLine && !parsed.finalAnswer && visibleFacts.length === 0) {
    return <EmptyHint>No context summary persisted for this run.</EmptyHint>;
  }

  return (
    <div className="space-y-3">
      {statusLine ? (
        <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              errored ? "bg-destructive" : "bg-success",
            )}
          />
          {statusLine}
        </div>
      ) : null}

      {parsed.finalAnswer ? (
        <Disclosure
          defaultOpen={false}
          trigger={({ open }) => (
            <span className="inline-flex max-w-full items-center gap-1 text-[12px] font-medium text-primary hover:text-primary/80">
              Final answer
              {open ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
            </span>
          )}
        >
          <div className="mt-2 rounded-lg border border-border bg-card px-3 py-2.5">
            <Markdown className="text-[11.5px] leading-relaxed text-foreground/85 [&_p]:text-[11.5px] [&_li]:text-[11.5px] [&_h1]:text-[13px] [&_h2]:text-xs [&_h3]:text-xs [&_code]:text-[10px] [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
              {parsed.finalAnswer}
            </Markdown>
          </div>
        </Disclosure>
      ) : null}

      {visibleFacts.length > 0 ? <FactsSection facts={visibleFacts} /> : null}
    </div>
  );
}

function FactsSection({ facts }: { facts: string[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/65">
          Facts
        </span>
        <span className="rounded-full border border-border bg-secondary px-1.5 py-px text-[9.5px] font-semibold text-muted-foreground">
          {facts.length}
        </span>
      </div>
      <ul className="space-y-2">
        {facts.map((fact, index) => (
          <StructuredFactRow key={`${index}-${fact.slice(0, 24)}`} fact={fact} />
        ))}
      </ul>
    </div>
  );
}

const FACT_CHIP_LIMIT = 8;

function StructuredFactRow({ fact }: { fact: string }) {
  const colonIndex = fact.indexOf(":");
  if (colonIndex > 0 && colonIndex < 48) {
    const label = fact.slice(0, colonIndex).trim();
    const value = fact.slice(colonIndex + 1).trim();
    const chips = value.split(",").map((part) => part.trim()).filter(Boolean);

    if (chips.length > 1) {
      return <FactChipGroup label={label} chips={chips} />;
    }

    return (
      <li className="break-words text-[11px] leading-snug">
        <span className="font-medium text-muted-foreground">{label}:</span>{" "}
        <span className="font-mono text-foreground/85">{value}</span>
      </li>
    );
  }

  return (
    <li className="break-words font-mono text-[10.5px] leading-snug text-muted-foreground/90">
      {fact}
    </li>
  );
}

function FactChipGroup({ label, chips }: { label: string; chips: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? chips : chips.slice(0, FACT_CHIP_LIMIT);
  const hidden = chips.length - visible.length;
  const chipClass =
    "rounded-[5px] border border-border bg-input px-[7px] py-[3px] font-mono text-[9.5px] text-muted-foreground";
  const moreClass =
    "rounded-[5px] border border-border px-[7px] py-[3px] font-mono text-[9.5px] text-muted-foreground/70 transition-colors hover:text-foreground";

  return (
    <li className="space-y-1.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((chip) => (
          <span key={`${label}-${chip}`} className={chipClass}>
            {chip}
          </span>
        ))}
        {hidden > 0 ? (
          <button type="button" onClick={() => setExpanded(true)} className={moreClass}>
            + {hidden} more
          </button>
        ) : expanded && chips.length > FACT_CHIP_LIMIT ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className={moreClass}
          >
            show less
          </button>
        ) : null}
      </div>
    </li>
  );
}

function parseContextSummary(summary: string): {
  metaLines: string[];
  finalAnswer: string | null;
} {
  const lines = summary.split("\n");
  const metaLines: string[] = [];
  const answerLines: string[] = [];
  let inFinalAnswer = false;

  for (const line of lines) {
    if (line.startsWith("Final answer:")) {
      inFinalAnswer = true;
      const rest = line.slice("Final answer:".length).trim();
      if (rest) answerLines.push(rest);
      continue;
    }
    if (
      line.startsWith("Facts:") ||
      line.startsWith("Commands:") ||
      line.startsWith("Files:")
    ) {
      inFinalAnswer = false;
      continue;
    }
    if (inFinalAnswer) {
      answerLines.push(line);
      continue;
    }
    if (line.startsWith("Run status:") || line.startsWith("Run error:")) {
      metaLines.push(line);
    }
  }

  const finalAnswer = answerLines.join("\n").trim();
  if (finalAnswer.length > 0) {
    return { metaLines, finalAnswer };
  }

  const bodyLines = lines.filter(
    (line) =>
      line.trim().length > 0 &&
      !line.startsWith("Run status:") &&
      !line.startsWith("Run error:") &&
      !line.startsWith("Facts:") &&
      !line.startsWith("Commands:") &&
      !line.startsWith("Files:"),
  );
  const body = bodyLines.join("\n").trim();

  return {
    metaLines,
    finalAnswer: body.length > 0 ? body : null,
  };
}

function dedupeContextFacts(
  facts: string[],
  summary: string,
  finalAnswer: string | null,
): string[] {
  const haystack = `${summary}\n${finalAnswer ?? ""}`.toLowerCase();
  return facts.filter((fact) => {
    const normalized = fact.trim().toLowerCase();
    if (!normalized) return false;
    if (haystack.includes(normalized)) return false;

    const label = fact.split(":")[0]?.trim().toLowerCase();
    if (label && haystack.includes(`${label}:`)) {
      return false;
    }

    return true;
  });
}

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] italic text-muted-foreground/80">{children}</p>
  );
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

function buildRunSummaryText(details: ProjectRunDetailsSummary): string {
  const { run, events, toolCalls, context } = details;
  const lines: string[] = [
    `Run ${run.status} · ${run.model}`,
    ...(run.provider ? [`Provider: ${run.provider}`] : []),
    ...(run.finishReason ? [`Finish: ${run.finishReason}`] : []),
    ...(run.durationMs !== null
      ? [`Duration: ${formatDuration(run.durationMs)}`]
      : []),
    ...(run.stepCount !== null ? [`Steps: ${run.stepCount}`] : []),
    ...(run.profile ? [`Profile: ${run.profile}`] : []),
    ...(run.rawTotalTokens !== null && run.rawTotalTokens !== undefined
      ? [`Raw tokens: ${formatCount(run.rawTotalTokens)}`]
      : []),
    ...(run.effectiveTokens !== null && run.effectiveTokens !== undefined
      ? [`Effective tokens: ${formatCount(run.effectiveTokens)}`]
      : []),
    ...(run.cacheHitRate !== null && run.cacheHitRate !== undefined
      ? [`Cache hit rate: ${(run.cacheHitRate * 100).toFixed(1)}%`]
      : []),
    ...(run.loopGuardCount !== null && run.loopGuardCount !== undefined
      ? [`Loop guards: ${run.loopGuardCount}`]
      : []),
    ...(run.verificationSummary ? [`Verification: ${run.verificationSummary}`] : []),
    `Tokens: ${formatCount(run.totalTokens)} (in ${formatCount(run.inputTokens)} / out ${formatCount(run.outputTokens)})`,
    ...(run.costUsd !== null ? [`Cost: $${run.costUsd.toFixed(4)}`] : []),
    "",
    `Timeline (${events.length}):`,
    ...events.map(
      (event) =>
        `  ${event.sequence}. [${event.kind}] ${event.label}${
          event.durationMs !== null ? ` (${formatDuration(event.durationMs)})` : ""
        }`,
    ),
    "",
    `Tool calls (${toolCalls.length}):`,
    ...toolCalls.map((toolCall) => {
      const parts = [`  ${toolCall.toolName} · ${toolCall.status}`];
      if (toolCall.stepNumber !== null) {
        parts.push(`step ${harnessStepDisplayNumber(toolCall.stepNumber)}`);
      }
      if (toolCall.approvalDecision) parts.push(toolCall.approvalDecision);
      if (toolCall.durationMs !== null) {
        parts.push(formatDuration(toolCall.durationMs));
      }
      if (toolCall.inputSummary) parts.push(`in: ${toolCall.inputSummary}`);
      if (toolCall.outputSummary) parts.push(`out: ${toolCall.outputSummary}`);
      if (toolCall.error) parts.push(`error: ${toolCall.error}`);
      return parts.join(" · ");
    }),
  ];

  if (context?.summary.trim()) {
    lines.push("", "Context:", context.summary.trim());
  }

  return lines.join("\n");
}
