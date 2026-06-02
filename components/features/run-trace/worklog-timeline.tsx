"use client";

import { useMemo, useState } from "react";
import type { ChatAddToolApproveResponseFunction } from "ai";
import {
  CheckCircle2,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  getApprovalMetadata,
  messageHasBudgetLimit,
  type AntonUIMessage,
  type ToolTraceEntry,
} from "@/src/lib/trace";
import type { BashOutput } from "@/components/features/run-trace/terminal-utils";
import { TerminalOutput } from "@/components/features/run-trace/terminal-output";
import { LiveTerminalOutput } from "@/components/features/run-trace/live-terminal";
import { ApprovalDetails } from "@/components/features/run-trace/approval-details";
import { DiffView, PatchDiffView } from "@/components/features/run-trace/diff-view";
import { TodoCard } from "@/components/features/run-trace/todo-card";
import {
  effectiveToolState,
  isOkEditFileOutput,
  isOkEditTextOutput,
  isOkWriteFileOutput,
  pickString,
  riskCategoryBadge,
  safeStringify,
} from "@/components/features/run-trace/tool-display";
import type { WriteFileOkOutput } from "@/components/features/run-trace/tool-display";
import {
  getSessionTimelineRunGroups,
  harnessStepDisplayNumber,
  runTimelineGroupLabel,
  type SessionTimelineItem,
  type SessionTimelineRunGroup,
} from "@/components/features/run-trace/trace-data";
import {
  Hash,
  Layers,
} from "lucide-react";
import {
  PermissionLabel,
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
  parseHarnessStepNumber,
  StepCacheIndicator,
  stepUsageByNumber,
  stepUsageFromCostMetadata,
} from "@/components/features/run-trace/trace-usage-ui";

const LIVE_WORKLOG_STEP_LIMIT = 4;
const LIVE_WORKLOG_ITEM_LIMIT = 8;

export function WorklogTimeline({
  messages,
  streaming = false,
  onApproval,
}: {
  messages: AntonUIMessage[];
  streaming?: boolean;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const latestMessage = messages.at(-1);
  const liveMessage =
    streaming && latestMessage?.role === "assistant" ? latestMessage : undefined;
  const stableTimelineMessages =
    liveMessage === undefined ? messages : messages.slice(0, -1);
  const stableTimelineKey = stableTimelineMessages
    .map((message) => message.id)
    .join("|");
  const stableGroups = useMemo(
    () => getSessionTimelineRunGroups(stableTimelineMessages),
    // Stable persisted messages do not change while the active assistant streams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stableTimelineKey],
  );
  const liveGroups = useMemo(
    () => (liveMessage ? getSessionTimelineRunGroups([liveMessage]) : []),
    [liveMessage],
  );
  const groups = useMemo(
    () => (liveMessage ? [...stableGroups, ...liveGroups] : stableGroups),
    [liveGroups, liveMessage, stableGroups],
  );
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  if (groups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
        Tool activity will appear here when Anton reads, searches, edits, or
        runs commands.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <TraceThreadRoot>
        {groups.map((group) => {
          const message =
            messages.find((candidate) => candidate.id === group.messageId) ??
            messages.at(-1)!;
          const budgetLimited = messageHasBudgetLimit(message);
          const runMeta = timelineEventMeta(
            "progress",
            group.run.status === "running"
              ? "running"
              : group.run.status === "error"
                ? "error"
                : "completed",
          );
          const stepUsageMap = stepUsageByNumber(
            stepUsageFromCostMetadata(group.run.costMetadata),
          );
          const visibleSteps = visibleStepsForGroup(group);

          return (
            <TraceThreadNode key={group.runId}>
              <TraceThreadHeaderRow
                icon={Layers}
                iconClass={runMeta.iconClass}
                dotClass={runMeta.dotClass}
                label={runTimelineGroupLabel(group)}
                durationMs={group.run.durationMs}
                status={group.run.status}
              />
              <TraceThreadChildren>
                {visibleSteps.map((step) => {
                  const stepMeta = timelineEventMeta("step", "completed");
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
                        dotClass={stepMeta.dotClass}
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
                          {step.items.map((item) =>
                            renderTimelineItem({
                              item,
                              budgetLimited,
                              expandedItemId,
                              setExpandedItemId,
                              onApproval,
                            }),
                          )}
                        </TraceThreadChildren>
                      ) : null}
                    </TraceThreadNode>
                  );
                })}
              </TraceThreadChildren>
            </TraceThreadNode>
          );
        })}
      </TraceThreadRoot>
    </div>
  );
}

function visibleStepsForGroup(
  group: SessionTimelineRunGroup,
): SessionTimelineRunGroup["steps"] {
  if (group.run.status !== "running") {
    return group.steps;
  }

  return group.steps.slice(-LIVE_WORKLOG_STEP_LIMIT).map((step) => ({
    ...step,
    items: step.items.slice(-LIVE_WORKLOG_ITEM_LIMIT),
  }));
}

function renderTimelineItem({
  item,
  budgetLimited,
  expandedItemId,
  setExpandedItemId,
  onApproval,
}: {
  item: SessionTimelineItem;
  budgetLimited: boolean;
  expandedItemId: string | null;
  setExpandedItemId: (value: string | null | ((current: string | null) => string | null)) => void;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const expandable = item.expandable;
  const itemExpanded = expandedItemId === item.id;

  return (
    <TraceThreadNode key={item.id}>
      <TraceTimelineRow
        kind={item.kind}
        status={displayItemStatus(item, budgetLimited)}
        label={item.label}
        durationMs={item.durationMs}
        expandable={expandable}
        expanded={itemExpanded}
        summary={!expandable ? item.summary : undefined}
        onToggle={
          expandable
            ? () =>
                setExpandedItemId((current) =>
                  current === item.id ? null : item.id,
                )
            : undefined
        }
      >
        {item.kind === "tool" && item.tool ? (
          <ToolEntryExpandPanel
            entry={item.tool}
            runStatus={item.runStatus}
            onApproval={onApproval}
          />
        ) : item.kind === "reasoning" && item.reasoningText ? (
          <TraceExpandPanel>
            <pre className="max-h-48 overflow-y-auto font-mono text-[10px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
              {item.reasoningText}
            </pre>
          </TraceExpandPanel>
        ) : item.kind === "todos" && item.todoSnapshot ? (
          <TodoCard snapshot={item.todoSnapshot} compact />
        ) : item.summary ? (
          <TraceExpandPanel errored={item.status === "error"}>
            <p className="break-words font-mono text-[10px] leading-snug text-muted-foreground">
              {item.summary}
            </p>
          </TraceExpandPanel>
        ) : null}
      </TraceTimelineRow>
    </TraceThreadNode>
  );
}

function displayItemStatus(
  item: SessionTimelineItem,
  budgetLimited: boolean,
): SessionTimelineItem["status"] {
  if (item.kind !== "tool" || !item.tool) return item.status;
  const effectiveState = effectiveToolState(item.tool);
  if (
    item.runStatus !== "running" &&
    item.tool.activity?.status === "running" &&
    (effectiveState === "input-streaming" ||
      effectiveState === "input-available")
  ) {
    return budgetLimited ? "completed" : "error";
  }
  if (effectiveState === "output-error") return "error";
  return item.status;
}

function ToolEntryExpandPanel({
  entry,
  runStatus,
  onApproval,
}: {
  entry: ToolTraceEntry;
  runStatus: SessionTimelineRunGroup["run"]["status"];
  budgetLimited?: boolean;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const displayState = effectiveToolState(entry);
  const errored =
    displayState === "output-error" ||
    (entry.state === "output-available" &&
      typeof entry.output === "object" &&
      entry.output !== null &&
      "ok" in entry.output &&
      (entry.output as { ok: unknown }).ok === false);
  const denied = displayState === "output-denied";
  const approvalMeta =
    entry.state === "approval-requested"
      ? getApprovalMetadata(entry)
      : undefined;
  const permissionLabel = approvalMeta?.riskCategories[0];
  const streamToken = pickString(entry.activity?.details, "streamToken");
  const showWriteDiff =
    entry.name === "write_file" &&
    entry.state === "output-available" &&
    isOkWriteFileOutput(entry.output) &&
    pickString(entry.input, "content") !== undefined;
  const editOutput = isOkEditFileOutput(entry.output) ? entry.output : undefined;
  const editTextOutput = isOkEditTextOutput(entry.output)
    ? entry.output
    : undefined;
  const showEditDiff =
    entry.name === "edit_file" &&
    entry.state === "output-available" &&
    typeof editOutput?.previousContent === "string" &&
    typeof editOutput.nextContent === "string";
  const showEditTextDiff =
    entry.name === "edit_text" &&
    entry.state === "output-available" &&
    typeof editTextOutput?.patchPreview === "string";

  return (
    <TraceExpandPanel errored={errored} denied={denied}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-medium text-foreground/90">
          {entry.name}
          {permissionLabel ? (
            <PermissionLabel label={permissionLabel} />
          ) : null}
        </span>
        {displayState !== "output-available" || errored ? (
          <StatusPill
            status={
              errored
                ? "error"
                : denied
                  ? "denied"
                  : displayState === "approval-requested"
                    ? "pending"
                    : "running"
            }
          />
        ) : null}
        {entry.activity?.details &&
        typeof entry.activity.details === "object" &&
        "stepNumber" in entry.activity.details &&
        typeof entry.activity.details.stepNumber === "number" ? (
          <span className="text-[10px] text-muted-foreground">
            step {harnessStepDisplayNumber(entry.activity.details.stepNumber)}
          </span>
        ) : null}
      </div>

      {approvalMeta ? (
        <div className="mt-1.5 space-y-1 border-t border-border/30 pt-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <ShieldCheck className="size-3 shrink-0 text-sky-400/90" />
            <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-foreground/85">
              {approvalMeta.title}
            </span>
            {entry.state === "approval-requested" ? (
              <StatusPill status="pending" />
            ) : null}
          </div>
          <ApprovalDetails approval={approvalMeta} compact />
          {approvalMeta.riskCategories.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {approvalMeta.riskCategories.map((category) => {
                const badge = riskCategoryBadge(category);
                return (
                  <span
                    key={category}
                    className={cn(
                      "rounded px-1.5 py-px font-mono text-[9px] uppercase tracking-wide",
                      badge.baseClass,
                    )}
                  >
                    {badge.label}
                  </span>
                );
              })}
            </div>
          ) : null}
          {entry.state === "approval-requested" && entry.approvalId ? (
            <div className="flex items-center gap-1 pt-0.5">
              <button
                type="button"
                className="inline-flex size-6 items-center justify-center rounded hover:bg-emerald-500/15"
                title="Approve"
                onClick={() =>
                  onApproval({ id: entry.approvalId as string, approved: true })
                }
              >
                <CheckCircle2 className="size-4 text-emerald-400" />
              </button>
              <button
                type="button"
                className="inline-flex size-6 items-center justify-center rounded hover:bg-destructive/15"
                title="Deny"
                onClick={() =>
                  onApproval({ id: entry.approvalId as string, approved: false })
                }
              >
                <XCircle className="size-4 text-destructive" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {approvalMeta?.diffPreview ? (
        <div className="mt-1.5 border-t border-border/30 pt-1.5">
          <DiffView
            previous={approvalMeta.diffPreview.previous}
            next={approvalMeta.diffPreview.next}
            newFile={approvalMeta.diffPreview.previous.length === 0}
          />
        </div>
      ) : null}

      <div className="mt-1.5 border-t border-border/30 pt-1.5">
        {showWriteDiff ? (
          <DiffView
            previous={(entry.output as WriteFileOkOutput).previousContent ?? ""}
            next={pickString(entry.input, "content") ?? ""}
            newFile={(entry.output as WriteFileOkOutput).existed === false}
            filename={pickString(entry.input, "path")}
          />
        ) : showEditDiff ? (
          <DiffView
            previous={editOutput?.previousContent ?? ""}
            next={editOutput?.nextContent ?? ""}
            filename={pickString(entry.input, "path")}
          />
        ) : showEditTextDiff ? (
          <PatchDiffView
            patch={editTextOutput?.patchPreview ?? null}
            filename={editTextOutput?.path ?? pickString(entry.input, "path") ?? "diff.txt"}
          />
        ) : entry.name === "bash" &&
          runStatus === "running" &&
          entry.activity?.status === "running" &&
          entry.activity?.toolCallId ? (
          <LiveTerminalOutput
            command={pickString(entry.input, "command")}
            streamId={entry.activity.toolCallId}
            streamToken={streamToken}
            initialOutput={
              typeof entry.output === "object" && entry.output !== null
                ? (entry.output as {
                    stdout?: string;
                    stderr?: string;
                    exitCode?: number | null;
                    timedOut?: boolean;
                    killed?: boolean;
                    failedReason?:
                      | "timeout"
                      | "killed"
                      | "max_buffer"
                      | "error";
                  })
                : undefined
            }
          />
        ) : entry.name === "bash" ? (
          <TerminalOutput
            command={
              pickString(entry.input, "command") ?? safeStringify(entry.input)
            }
            output={bashOutputFromEntry(entry)}
            className="text-[10px]"
          />
        ) : (
          <ToolIoBlocks entry={entry} />
        )}
      </div>
    </TraceExpandPanel>
  );
}

function ToolIoBlocks({ entry }: { entry: ToolTraceEntry }) {
  if (entry.name === "grep" && isGrepOutput(entry.output)) {
    return <GrepOutputPanel output={entry.output} />;
  }

  const inputText = safeStringify(entry.input);
  const durableOutput =
    entry.name === "read_file" &&
    entry.activity?.details &&
    typeof entry.activity.details === "object" &&
    "durableOutput" in entry.activity.details
      ? safeStringify(entry.activity.details.durableOutput)
      : undefined;
  const modelVisibleOutput =
    entry.name === "read_file" &&
    entry.activity?.details &&
    typeof entry.activity.details === "object" &&
    "modelVisibleOutput" in entry.activity.details
      ? safeStringify(entry.activity.details.modelVisibleOutput)
      : undefined;
  const outputText =
    entry.state === "output-error" && entry.errorText
      ? undefined
      : durableOutput ??
        (entry.output !== undefined ? safeStringify(entry.output) : undefined);

  return (
    <div className="space-y-1.5">
      {inputText ? (
        <TraceLogBlock title="Input">{inputText}</TraceLogBlock>
      ) : null}
      {outputText ? (
        <TraceLogBlock title={durableOutput ? "Durable output" : "Output"}>
          {outputText}
        </TraceLogBlock>
      ) : null}
      {modelVisibleOutput && modelVisibleOutput !== outputText ? (
        <TraceLogBlock title="Model-visible output">
          {modelVisibleOutput}
        </TraceLogBlock>
      ) : null}
      {entry.errorText ? (
        <TraceLogBlock title="Error" tone="error">
          {entry.errorText}
        </TraceLogBlock>
      ) : null}
    </div>
  );
}

type GrepOutput = {
  ok: true;
  pattern: string;
  target?: string;
  matchCount: number;
  truncated?: boolean;
  matches: { file: string; line: number; text: string }[];
};

function isGrepOutput(value: unknown): value is GrepOutput {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.ok === true &&
    typeof record.pattern === "string" &&
    typeof record.matchCount === "number" &&
    Array.isArray(record.matches)
  );
}

function GrepOutputPanel({ output }: { output: GrepOutput }) {
  return (
    <div className="space-y-1.5">
      <div className="rounded border border-border/50 bg-background/40 px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
        <span className="text-foreground/80">{output.matchCount}</span>{" "}
        match{output.matchCount === 1 ? "" : "es"} for{" "}
        <span className="text-foreground/80">{output.pattern}</span>
        {output.target ? (
          <>
            {" "}in <span className="text-foreground/80">{output.target}</span>
          </>
        ) : null}
        {output.truncated ? " (truncated)" : null}
      </div>
      {output.matches.length > 0 ? (
        <div className="max-h-56 overflow-y-auto rounded border border-border/50 bg-card/30">
          {output.matches.map((match) => (
            <div
              key={`${match.file}:${match.line}:${match.text}`}
              className="border-b border-border/30 px-2 py-1 last:border-b-0"
            >
              <div className="font-mono text-[10px] text-muted-foreground">
                {match.file}:{match.line}
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-foreground/85">
                {match.text}
              </pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded border border-border/50 bg-card/30 px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
          No matching lines.
        </div>
      )}
    </div>
  );
}

function bashOutputFromEntry(entry: ToolTraceEntry): BashOutput {
  const failedReason = parseFailedReason(
    entry.errorText ?? pickString(entry.output as Record<string, unknown>, "failedReason"),
  );
  const stdout =
    typeof entry.output === "object" &&
    entry.output !== null &&
    typeof (entry.output as Record<string, unknown>).stdout === "string"
      ? ((entry.output as Record<string, unknown>).stdout as string)
      : undefined;
  const stderr =
    entry.errorText && entry.errorText !== failedReason
      ? entry.errorText
      : typeof entry.output === "object" &&
          entry.output !== null &&
          typeof (entry.output as Record<string, unknown>).stderr === "string"
        ? ((entry.output as Record<string, unknown>).stderr as string)
        : undefined;

  return {
    ...(stdout ? { stdout } : {}),
    ...(stderr ? { stderr } : {}),
    exitCode:
      typeof entry.output === "object" &&
      entry.output !== null &&
      typeof (entry.output as Record<string, unknown>).exitCode === "number"
        ? ((entry.output as Record<string, unknown>).exitCode as number)
        : entry.state === "output-error"
          ? 1
          : null,
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
