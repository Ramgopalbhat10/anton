"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { ChatAddToolApproveResponseFunction } from "ai";
import {
  CheckCircle2,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  getApprovalMetadata,
  type AntonUIMessage,
  type ToolTraceEntry,
} from "@/src/lib/trace";
import type { BashOutput } from "@/components/features/run-trace/terminal-utils";
import { TerminalOutput } from "@/components/features/run-trace/terminal-output";
import { LiveTerminalOutput } from "@/components/features/run-trace/live-terminal";
import { BashTerminalFooter } from "@/components/features/run-trace/bash-terminal";
import {
  ToolDetailCard,
  ToolDetailFooter,
  ToolDetailSection,
} from "@/components/features/run-trace/tool-detail-card";
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
  expandedItemId,
  setExpandedItemId,
  onApproval,
}: {
  item: SessionTimelineItem;
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
        status={displayItemStatus(item)}
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
          <TraceExpandPanel scrollable>
            <pre className="font-mono text-[10px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
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

function displayItemStatus(item: SessionTimelineItem): SessionTimelineItem["status"] {
  if (item.kind !== "tool" || !item.tool) return item.status;
  const effectiveState = effectiveToolState(item.tool);
  if (
    item.runStatus !== "running" &&
    item.tool.activity?.status === "running" &&
    (effectiveState === "input-streaming" ||
      effectiveState === "input-available")
  ) {
    return "error";
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
  const stepNumber = toolStepNumber(entry);
  const isLiveBash =
    entry.name === "bash" &&
    runStatus === "running" &&
    entry.activity?.status === "running" &&
    entry.activity?.toolCallId;
  const bashParsed =
    entry.name === "bash" ? bashOutputFromEntry(entry) : undefined;

  return (
    <ToolDetailCard
      toolName={entry.name}
      step={stepNumber}
      failed={errored}
      denied={denied}
      copyText={toolDetailCopyText(entry, bashParsed)}
      footer={toolDetailFooter(entry, errored, bashParsed, Boolean(isLiveBash && streamToken))}
    >
      {permissionLabel ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <PermissionLabel label={permissionLabel} />
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
        </div>
      ) : null}

      {approvalMeta ? (
        <div className="space-y-1">
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
        <DiffView
          previous={approvalMeta.diffPreview.previous}
          next={approvalMeta.diffPreview.next}
          newFile={approvalMeta.diffPreview.previous.length === 0}
        />
      ) : null}

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
      ) : isLiveBash && entry.activity?.toolCallId ? (
        <LiveTerminalOutput
          command={pickString(entry.input, "command")}
          streamId={entry.activity.toolCallId}
          streamToken={streamToken}
          variant="sections"
          includeFooter={false}
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
          output={bashParsed ?? {}}
          variant="sections"
          includeFooter={false}
        />
      ) : (
        <ToolIoBlocks entry={entry} />
      )}
    </ToolDetailCard>
  );
}

function toolStepNumber(entry: ToolTraceEntry): number | undefined {
  if (
    entry.activity?.details &&
    typeof entry.activity.details === "object" &&
    "stepNumber" in entry.activity.details &&
    typeof entry.activity.details.stepNumber === "number"
  ) {
    return harnessStepDisplayNumber(entry.activity.details.stepNumber);
  }
  return undefined;
}

function toolDetailCopyText(
  entry: ToolTraceEntry,
  bashParsed: BashOutput | undefined,
): string | undefined {
  if (entry.name === "bash") {
    const command = pickString(entry.input, "command");
    const parts: string[] = [];
    if (command) parts.push(`$ ${command}`);
    if (bashParsed?.stdout) parts.push(bashParsed.stdout);
    if (bashParsed?.stderr) parts.push(bashParsed.stderr);
    return parts.length > 0 ? parts.join("\n\n") : command ?? undefined;
  }

  const inputText = safeStringify(entry.input);
  const outputText =
    entry.state === "output-error" && entry.errorText
      ? entry.errorText
      : entry.output !== undefined
        ? safeStringify(entry.output)
        : undefined;
  const parts = [inputText, outputText].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function toolDetailFooter(
  entry: ToolTraceEntry,
  errored: boolean,
  bashParsed: BashOutput | undefined,
  isRunning: boolean,
): ReactNode {
  if (entry.name === "bash") {
    return (
      <BashTerminalFooter
        {...bashParsed}
        isRunning={isRunning}
      />
    );
  }

  if (
    typeof entry.output === "object" &&
    entry.output !== null &&
    "ok" in entry.output
  ) {
    const record = entry.output as Record<string, unknown>;
    if (record.ok === true) {
      return (
        <ToolDetailFooter>
          <span className="font-mono text-[11px] font-semibold text-success">
            Completed successfully
          </span>
        </ToolDetailFooter>
      );
    }
    if (record.ok === false) {
      const error =
        typeof record.error === "string"
          ? record.error
          : "Operation failed";
      return (
        <ToolDetailFooter>
          <span className="font-mono text-[11px] font-semibold text-destructive">
            {error}
          </span>
        </ToolDetailFooter>
      );
    }
  }

  if (errored && entry.errorText) {
    return (
      <ToolDetailFooter>
        <span className="font-mono text-[11px] font-semibold text-destructive">
          {entry.errorText}
        </span>
      </ToolDetailFooter>
    );
  }

  return null;
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
    <div className="flex flex-col gap-2.5">
      {inputText ? (
        <ToolDetailSection label="Input" scrollable>
          <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.65] text-muted-foreground">
            {inputText}
          </pre>
        </ToolDetailSection>
      ) : null}
      {outputText ? (
        <ToolDetailSection
          label={durableOutput ? "Durable output" : "Output"}
          scrollable
        >
          <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.65] text-muted-foreground">
            {outputText}
          </pre>
        </ToolDetailSection>
      ) : null}
      {modelVisibleOutput && modelVisibleOutput !== outputText ? (
        <ToolDetailSection label="Model-visible output" scrollable>
          <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.65] text-muted-foreground">
            {modelVisibleOutput}
          </pre>
        </ToolDetailSection>
      ) : null}
      {entry.errorText ? (
        <ToolDetailSection label="Error" tone="error" scrollable>
          <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.65] text-muted-foreground">
            {entry.errorText}
          </pre>
        </ToolDetailSection>
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
    <div className="flex flex-col gap-2.5">
      <ToolDetailSection label="Output" scrollable maxHeight="max-h-56">
        <div className="space-y-2 font-mono text-[10.5px] leading-[1.65] text-muted-foreground">
          <div>
            <span className="text-foreground/80">{output.matchCount}</span>{" "}
            match{output.matchCount === 1 ? "" : "es"} for{" "}
            <span className="text-foreground/80">{output.pattern}</span>
            {output.target ? (
              <>
                {" "}
                in <span className="text-foreground/80">{output.target}</span>
              </>
            ) : null}
            {output.truncated ? " (truncated)" : null}
          </div>
          {output.matches.length > 0 ? (
            <div className="space-y-1">
              {output.matches.map((match) => (
                <div
                  key={`${match.file}:${match.line}:${match.text}`}
                  className="border-t border-layout-border pt-1 first:border-t-0 first:pt-0"
                >
                  <div className="text-muted-foreground/80">
                    {match.file}:{match.line}
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-foreground/85">
                    {match.text}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div>No matching lines.</div>
          )}
        </div>
      </ToolDetailSection>
    </div>
  );
}

function bashOutputFromEntry(entry: ToolTraceEntry): BashOutput {
  const failedReason = parseFailedReason(
    entry.errorText ?? pickString(entry.output as Record<string, unknown>, "failedReason"),
  );
  const commandPolicyMode = pickCommandPolicyMode(entry.output);
  const boundary = pickExecutionBoundary(entry.output);
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
    ...(commandPolicyMode ? { commandPolicyMode } : {}),
    ...(boundary ? { boundary } : {}),
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

function pickCommandPolicyMode(
  output: unknown,
): BashOutput["commandPolicyMode"] {
  if (typeof output !== "object" || output === null) return undefined;
  const value = (output as Record<string, unknown>).commandPolicyMode;
  return value === "enforced" || value === "advisory" ? value : undefined;
}

function pickExecutionBoundary(output: unknown): BashOutput["boundary"] {
  if (typeof output !== "object" || output === null) return undefined;
  const value = (output as Record<string, unknown>).boundary;
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.kind !== "workspace-cwd" ||
    record.confinement !== "unconfined" ||
    record.label !== "Workspace cwd only"
  ) {
    return undefined;
  }
  return {
    kind: "workspace-cwd",
    confinement: "unconfined",
    label: "Workspace cwd only",
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
