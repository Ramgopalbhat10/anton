"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Hash,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { Markdown } from "@/components/features/chat/markdown";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Disclosure } from "@/components/shared/disclosure";
import { ErrorBanner } from "@/components/shared/feedback-states";
import { TerminalOutput } from "@/components/features/run-trace/terminal-output";
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
  TraceLogBlock,
  TraceThreadChildren,
  TraceThreadHeaderRow,
  TraceThreadNode,
  TraceThreadRoot,
  TraceTimelineRow,
  timelineEventMeta,
} from "@/components/features/run-trace/trace-timeline-ui";
import {
  contextCompositionSections,
  contextCompositionTotalTokens,
} from "@/src/lib/context-composition";
import { cn } from "@/lib/utils";
import type {
  ProjectRunDetailsApproval,
  ProjectRunDetailsEvent,
  ProjectRunDetailsSummary,
  ProjectRunDetailsToolCall,
} from "@/src/lib/api-types";
import { getJson } from "@/src/lib/client-fetch";

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
        <Loader2 className="size-3.5 animate-spin text-sky-400" />
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 gap-2">
        <TabsList size="md" className="w-full">
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="trace">
            Trace
            {traceEventCount > 0 ? (
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {traceEventCount}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="context">Context</TabsTrigger>
        </TabsList>

        <TabsContent value="usage" className="m-0">
          <TokenUsagePanel run={run} />
        </TabsContent>

        <TabsContent value="trace" className="m-0">
          {traceEventCount === 0 ? (
            <EmptyHint>No events recorded.</EmptyHint>
          ) : (
            <TraceTimeline
              run={run}
              segmentCount={details.segmentCount}
              events={events}
              toolCalls={toolCalls}
              approvals={approvals}
            />
          )}
        </TabsContent>

        <TabsContent value="context" className="m-0">
          {context ? (
            <ContextPanel
              context={context}
              toolCalls={toolCalls}
              hideTools={toolCalls.length > 0}
            />
          ) : (
            <EmptyHint>No context summary persisted for this run.</EmptyHint>
          )}
        </TabsContent>
      </Tabs>

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
        <MetaChip>{run.provider}</MetaChip>
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
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="ml-auto h-6 gap-1 px-2 text-[10px] text-muted-foreground"
        onClick={onCopy}
      >
        {copied ? (
          <Check className="size-3 text-emerald-400" />
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
  accent?: "default" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-mono ring-1",
        accent === "default"
          ? "bg-secondary/60 text-foreground/85 ring-border/70"
          : "bg-background/40 text-muted-foreground ring-border/50",
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
}: {
  run: ProjectRunDetailsSummary["run"];
  segmentCount?: number;
  events: ProjectRunDetailsEvent[];
  toolCalls: ProjectRunDetailsToolCall[];
  approvals: ProjectRunDetailsApproval[];
}) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
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
            dotClass={runMeta.dotClass}
            label={group.label}
            durationMs={group.durationMs}
            status={run.status === "error" ? "error" : "completed"}
          />
          <TraceThreadChildren>
            {group.steps.map((step) => (
              <TraceThreadNode key={step.id}>
                <TraceThreadHeaderRow
                  icon={Hash}
                  iconClass={stepMeta.iconClass}
                  dotClass={stepMeta.dotClass}
                  label={step.label}
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
                              <TraceExpandPanel>
                                <pre className="max-h-48 overflow-y-auto font-mono text-[10px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
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
            ))}
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
          durationMs: event.durationMs ?? undefined,
          startedAt: event.startedAt,
        })),
      ),
    };
  });
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
  const showApproval = approval !== undefined;
  const showIo = Boolean(
    toolCall.inputSummary || toolCall.outputSummary || toolCall.error,
  );

  return (
    <div
      className={cn(
        "mt-1.5 rounded-md border border-border/50 bg-background/30 px-2 py-1.5 text-[10px]",
        errored && "border-destructive/25 bg-destructive/[0.03]",
        denied && "border-border/40 bg-secondary/15",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-medium text-foreground/90">
          {toolCall.toolName}
          {toolCall.permissionLabel ? (
            <PermissionLabel label={toolCall.permissionLabel} />
          ) : null}
        </span>
        {toolCall.status !== "completed" ? (
          <StatusPill status={toolCall.status} />
        ) : null}
        {toolCall.stepNumber !== null ? (
          <span className="text-[10px] text-muted-foreground">
            step {harnessStepDisplayNumber(toolCall.stepNumber)}
          </span>
        ) : null}
        {toolCall.approvalDecision &&
        (toolCall.approvalDecision === "pending" ||
          toolCall.approvalDecision === "denied") ? (
          <StatusPill status={toolCall.approvalDecision} />
        ) : null}
        {toolCall.exitCode !== null && toolCall.exitCode !== 0 ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            exit {toolCall.exitCode}
          </span>
        ) : null}
      </div>

      {showApproval && approval ? (
        <div className="mt-1.5 space-y-1 border-t border-border/30 pt-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <ShieldCheck className="size-3 shrink-0 text-sky-400/90" />
            <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-foreground/85">
              {approval.title}
            </span>
            {approval.decision === "pending" || approval.decision === "denied" ? (
              <StatusPill status={approval.decision} />
            ) : null}
          </div>
          <p className="break-words text-[10px] leading-snug text-muted-foreground">
            {approval.summary}
          </p>
          {approval.riskCategories.filter(
            (category) => category !== toolCall.permissionLabel,
          ).length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {approval.riskCategories
                .filter((category) => category !== toolCall.permissionLabel)
                .map((category) => (
                  <span
                    key={category}
                    className="rounded bg-amber-400/10 px-1.5 py-px font-mono text-[9px] text-amber-400 ring-1 ring-amber-400/20"
                  >
                    {category}
                  </span>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {showIo ? (
        <div className="mt-1.5 border-t border-border/30 pt-1.5">
          <ToolCallIoPanel toolCall={toolCall} />
        </div>
      ) : null}
    </div>
  );
}

function ToolCallIoPanel({ toolCall }: { toolCall: ProjectRunDetailsToolCall }) {
  if (toolCall.toolName === "bash" && toolCall.inputSummary) {
    return (
      <TerminalOutput
        command={toolCall.inputSummary}
        output={bashOutputFromToolCall(toolCall)}
        className="text-[10px]"
      />
    );
  }

  const outputText =
    toolCall.outputSummary &&
    toolCall.outputSummary !== toolCall.error
      ? toolCall.outputSummary
      : undefined;

  return (
    <div className="space-y-1.5">
      {toolCall.inputSummary ? (
        <TraceLogBlock title="Input">{toolCall.inputSummary}</TraceLogBlock>
      ) : null}
      {outputText ? (
        <TraceLogBlock title="Output">{outputText}</TraceLogBlock>
      ) : null}
      {toolCall.error ? (
        <TraceLogBlock title="Error" tone="error">
          {toolCall.error}
        </TraceLogBlock>
      ) : null}
    </div>
  );
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
  const sections = composition
    ? contextCompositionSections(composition)
    : [];
  const compositionTotal = composition
    ? contextCompositionTotalTokens(composition)
    : 0;
  const providerInput = run.inputTokens ?? usage?.rawInputTokens;

  const billingNotes = [
    usage?.cachedInputTokens !== undefined && usage.cachedInputTokens > 0
      ? `${formatCompactCount(usage.cachedInputTokens)} cached read`
      : null,
    usage?.reasoningTokens !== undefined && usage.reasoningTokens > 0
      ? `${formatCompactCount(usage.reasoningTokens)} reasoning`
      : null,
    usage?.providerEffectiveTokens !== undefined
      ? `${formatCompactCount(usage.providerEffectiveTokens)} provider billed`
      : null,
  ].filter((note): note is string => note !== null);

  return (
    <div className="space-y-3">
      {sections.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-[11px] font-medium text-foreground/90">
              Context
            </h4>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              ~{formatCompactCount(compositionTotal)} tokens
            </span>
          </div>

          {compositionTotal > 0 ? (
            <div className="flex h-2 overflow-hidden rounded-full bg-muted/30">
              {sections.map((section) => (
                <div
                  key={section.key}
                  className={contextSectionColor(section.key)}
                  style={{
                    width: `${(section.tokens / compositionTotal) * 100}%`,
                  }}
                  title={`${section.label}: ${formatCompactCount(section.tokens)}`}
                />
              ))}
            </div>
          ) : null}

          <ul className="space-y-1">
            {sections.map((section) => (
              <li
                key={section.key}
                className="flex min-w-0 items-center gap-2 text-[11px]"
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-sm",
                    contextSectionColor(section.key),
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-foreground/85">
                  {section.label}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {formatCompactCount(section.tokens)}
                </span>
              </li>
            ))}
          </ul>

          <p className="text-[10px] leading-snug text-muted-foreground">
            Estimated from prompt size at run start. Provider-reported input was{" "}
            {formatCount(providerInput)} across all steps
            {run.stepCount !== null ? ` (${run.stepCount} steps)` : ""}.
          </p>
        </section>
      ) : (
        <EmptyHint>
          Context breakdown is available for new runs. Older runs only store
          provider totals.
        </EmptyHint>
      )}

      {billingNotes.length > 0 ? (
        <section className="space-y-1 border-t border-border/30 pt-2">
          <h4 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Billing notes
          </h4>
          <ul className="space-y-0.5 text-[10px] text-muted-foreground">
            {billingNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function contextSectionColor(key: string): string {
  switch (key) {
    case "system":
      return "bg-zinc-400/80";
    case "tools":
      return "bg-violet-500/75";
    case "memory":
      return "bg-emerald-500/70";
    case "skills":
      return "bg-orange-400/75";
    case "mcp":
      return "bg-fuchsia-400/70";
    case "profile":
      return "bg-sky-500/70";
    case "prior-context":
      return "bg-pink-400/70";
    case "conversation":
      return "bg-amber-600/65";
    default:
      return "bg-muted-foreground/50";
  }
}

function formatCompactCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1000) {
    const compact = value / 1000;
    return compact >= 10
      ? `${Math.round(compact)}K`
      : `${compact.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return value.toLocaleString();
}

function ContextPanel({
  context,
  toolCalls,
  hideTools = false,
}: {
  context: NonNullable<ProjectRunDetailsSummary["context"]>;
  toolCalls: ProjectRunDetailsToolCall[];
  hideTools?: boolean;
}) {
  const parsed = parseContextSummary(context.summary);
  const toolPaths = collectToolCallPaths(toolCalls);
  const visibleFiles = context.files.filter(
    (file) => !isPathCoveredByToolCalls(file.path, toolPaths),
  );
  const visibleFacts = dedupeContextFacts(
    context.facts,
    context.summary,
    parsed.finalAnswer,
  );
  const commandItems = context.commands
    .map((command) => {
      const status = command.ok
        ? "ok"
        : command.timedOut
          ? "timeout"
          : "failed";
      const exit =
        command.exitCode !== null ? ` · exit ${command.exitCode}` : "";
      return `${command.command} (${status}${exit})`;
    })
    .filter((item) => !isCommandCoveredByToolCalls(item, toolCalls));

  return (
    <div className="space-y-2.5">
      {parsed.metaLines.length > 0 ? (
        <div className="space-y-0.5 text-[10px] text-muted-foreground">
          {parsed.metaLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}

      {parsed.finalAnswer ? (
        <Disclosure
          defaultOpen={false}
          trigger={({ open }) => (
            <span className="inline-flex max-w-full items-center gap-1 text-[10px] font-medium text-foreground/85 hover:text-foreground">
              Final answer
              {open ? (
                <ChevronDown className="size-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3 text-muted-foreground" />
              )}
            </span>
          )}
        >
          <div className="mt-1.5 rounded-md border border-border/50 bg-background/25 px-2.5 py-2">
            <Markdown className="text-[10px] leading-relaxed text-foreground/85 [&_p]:text-[10px] [&_li]:text-[10px] [&_h1]:text-xs [&_h2]:text-[11px] [&_h3]:text-[11px] [&_code]:text-[9px] [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
              {parsed.finalAnswer}
            </Markdown>
          </div>
        </Disclosure>
      ) : null}

      {visibleFiles.length > 0 ? (
        <ContextGroup title="Files touched" count={visibleFiles.length}>
          <ul className="space-y-0.5 border-l border-border/50 pl-2.5">
            {visibleFiles.map((file) => (
              <li
                key={`${file.action}-${file.path}`}
                className="flex min-w-0 items-start gap-1.5 break-words font-mono text-[10px] leading-snug text-foreground/80"
              >
                <FileText className="mt-0.5 size-2.5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="text-muted-foreground">{file.action}</span>{" "}
                  {file.path}
                </span>
              </li>
            ))}
          </ul>
        </ContextGroup>
      ) : null}

      {visibleFacts.length > 0 ? (
        <CollapsibleContextGroup title="Facts" items={visibleFacts} structured />
      ) : null}

      {commandItems.length > 0 ? (
        <CollapsibleContextGroup title="Commands" items={commandItems} />
      ) : null}

      {!hideTools && context.tools.length > 0 ? (
        <CollapsibleContextGroup
          title="Tools"
          items={context.tools.map((tool) => {
            const parts = [tool.name, tool.status];
            if (tool.input) parts.push(`in: ${tool.input}`);
            if (tool.output) parts.push(`out: ${tool.output}`);
            if (tool.error) parts.push(tool.error);
            return parts.join(" · ");
          })}
        />
      ) : null}
    </div>
  );
}

function CollapsibleContextGroup({
  title,
  items,
  structured = false,
}: {
  title: string;
  items: string[];
  structured?: boolean;
}) {
  if (items.length <= 3) {
    return (
      <ContextGroup title={title} count={items.length}>
        {structured ? (
          <StructuredFactList facts={items} />
        ) : (
          <ContextItemList items={items} />
        )}
      </ContextGroup>
    );
  }

  return (
    <Disclosure
      trigger={({ open }) => (
        <span className="inline-flex max-w-full items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground/80">
          {title}
          <span className="rounded-full bg-secondary px-1.5 py-px font-mono text-[9px] normal-case">
            {items.length}
          </span>
          {open ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </span>
      )}
    >
      {structured ? (
        <StructuredFactList facts={items} />
      ) : (
        <ContextItemList items={items} />
      )}
    </Disclosure>
  );
}

function ContextGroup({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
        {count !== undefined ? (
          <span className="rounded-full bg-secondary px-1.5 py-px font-mono text-[9px] normal-case">
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function ContextItemList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1 border-l border-border/50 pl-2.5">
      {items.map((item, index) => (
        <li
          key={`${index}-${item.slice(0, 24)}`}
          className="break-words font-mono text-[10px] leading-snug text-muted-foreground/90"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function StructuredFactList({ facts }: { facts: string[] }) {
  return (
    <ul className="space-y-1.5 border-l border-border/50 pl-2.5">
      {facts.map((fact, index) => (
        <StructuredFactRow key={`${index}-${fact.slice(0, 24)}`} fact={fact} />
      ))}
    </ul>
  );
}

function StructuredFactRow({ fact }: { fact: string }) {
  const colonIndex = fact.indexOf(":");
  if (colonIndex > 0 && colonIndex < 48) {
    const label = fact.slice(0, colonIndex).trim();
    const value = fact.slice(colonIndex + 1).trim();
    const chips = value.split(",").map((part) => part.trim()).filter(Boolean);

    if (chips.length > 1 && chips.length <= 24) {
      return (
        <li className="space-y-1">
          <div className="text-[10px] font-medium text-muted-foreground">
            {label}
          </div>
          <div className="flex flex-wrap gap-1">
            {chips.map((chip) => (
              <span
                key={`${label}-${chip}`}
                className="rounded bg-secondary/60 px-1.5 py-px font-mono text-[9px] text-foreground/80 ring-1 ring-border/40"
              >
                {chip}
              </span>
            ))}
          </div>
        </li>
      );
    }

    return (
      <li className="break-words text-[10px] leading-snug">
        <span className="font-medium text-muted-foreground">{label}:</span>{" "}
        <span className="font-mono text-foreground/85">{value}</span>
      </li>
    );
  }

  return (
    <li className="break-words font-mono text-[10px] leading-snug text-muted-foreground/90">
      {fact}
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

function collectToolCallPaths(
  toolCalls: ProjectRunDetailsToolCall[],
): Set<string> {
  const paths = new Set<string>();
  for (const toolCall of toolCalls) {
    if (toolCall.inputSummary) {
      paths.add(normalizeContextPath(toolCall.inputSummary));
    }
    if (toolCall.outputSummary) {
      paths.add(normalizeContextPath(toolCall.outputSummary));
    }
  }
  return paths;
}

function normalizeContextPath(value: string): string {
  return value.trim().toLowerCase().replace(/\\/g, "/");
}

function isPathCoveredByToolCalls(
  path: string,
  toolPaths: Set<string>,
): boolean {
  const normalized = normalizeContextPath(path);
  if (toolPaths.has(normalized)) return true;
  for (const toolPath of toolPaths) {
    if (
      toolPath.endsWith(normalized) ||
      normalized.endsWith(toolPath) ||
      toolPath.includes(normalized) ||
      normalized.includes(toolPath)
    ) {
      return true;
    }
  }
  return false;
}

function isCommandCoveredByToolCalls(
  commandItem: string,
  toolCalls: ProjectRunDetailsToolCall[],
): boolean {
  const command = commandItem.replace(/\s+\([^)]*\)$/, "").trim().toLowerCase();
  if (!command) return false;
  return toolCalls.some((toolCall) => {
    const input = toolCall.inputSummary?.toLowerCase() ?? "";
    return (
      toolCall.toolName === "bash" &&
      (input === command || input.includes(command) || command.includes(input))
    );
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
