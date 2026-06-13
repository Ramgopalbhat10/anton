"use client";

import type { ChatAddToolApproveResponseFunction } from "ai";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Disclosure } from "@/components/shared/disclosure";
import {
  getApprovalMetadata,
  type AntonRunStatus,
  type ToolTraceEntry,
  type ToolState,
} from "@/src/lib/trace";

import { formatDuration, harnessStepDisplayNumber, toolTitle } from "./trace-data";
import {
  pickString,
  previewToolInput,
  riskCategoryBadge,
  safeStringify,
  effectiveToolState,
  traceToolStateMeta,
} from "./tool-display";
import { TerminalOutput } from "./terminal-output";
import { LiveTerminalOutput } from "./live-terminal";
import { ApprovalDetails } from "./approval-details";
import { DiffView } from "./diff-view";

export function ToolTraceRow({
  entry,
  runStatus,
  onApproval,
}: {
  entry: ToolTraceEntry;
  runStatus: AntonRunStatus;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const displayState = displayToolState(entry, runStatus);
  const meta = traceToolStateMeta(displayState);
  const approvalId =
    entry.state === "approval-requested" &&
    typeof entry.approvalId === "string"
      ? entry.approvalId
      : undefined;
  const needsApproval = approvalId !== undefined;
  const approvalMeta = needsApproval ? getApprovalMetadata(entry) : undefined;
  const showDetails = entry.name === "bash" || approvalMeta?.diffPreview !== undefined;
  const streamToken = pickString(entry.activity?.details, "streamToken");
  const stepNumber =
    entry.activity?.details &&
    typeof entry.activity.details === "object" &&
    "stepNumber" in entry.activity.details &&
    typeof entry.activity.details.stepNumber === "number"
      ? harnessStepDisplayNumber(entry.activity.details.stepNumber)
      : undefined;
  const title = toolTitle(entry, runStatus);
  const preview = previewToolInput(entry.input);
  const showPreview = preview.length > 0 && preview !== title.target;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1 py-0.5">
      <Disclosure
        className="min-w-0 py-0"
        disabled={!showDetails}
        trigger={({ open }) => (
          <span className="grid grid-cols-[0.875rem_minmax(0,1fr)] gap-2 rounded px-0 py-0">
            <meta.Icon className={cn("mt-0.5 size-3", meta.iconClass)} />
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-1.5">
                <ToolTitle title={title} />
                {showDetails &&
                  (open ? (
                    <ChevronDown className="size-3 shrink-0" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0" />
                  ))}
                {entry.name !== "bash" && meta.label.length > 0 && (
                  <span className={cn("shrink-0 text-[10px]", meta.textClass)}>
                    {meta.label}
                  </span>
                )}
                {approvalMeta && (
                  <span className="inline-flex items-center gap-0.5">
                    {approvalMeta.riskCategories.map((cat) => {
                      const badge = riskCategoryBadge(cat);
                      return (
                        <span
                          key={cat}
                          className={cn(
                            "rounded px-1 py-px text-[9px] uppercase tracking-wide",
                            badge.baseClass,
                          )}
                        >
                          {badge.label}
                        </span>
                      );
                    })}
                  </span>
                )}
                {entry.activity?.durationMs !== undefined && (
                  <span className="shrink-0 text-[11px] text-muted-foreground/70">
                    {formatDuration(entry.activity.durationMs)}
                  </span>
                )}
              </span>
              {showPreview && (
                <span className="block truncate font-mono text-[10px]">
                  {preview}
                </span>
              )}
              {approvalMeta && (
                <ApprovalDetails approval={approvalMeta} compact />
              )}
            </span>
          </span>
        )}
      >
        {showDetails && (
          <div className="min-h-0 overflow-hidden">
            <div className="ml-5 mt-1">
              {approvalMeta?.diffPreview ? (
                <DiffView
                  previous={approvalMeta.diffPreview.previous}
                  next={approvalMeta.diffPreview.next}
                  newFile={approvalMeta.diffPreview.previous.length === 0}
                />
              ) : entry.name === "bash" &&
              runStatus === "running" &&
              entry.activity?.status === "running" &&
              entry.activity?.toolCallId ? (
                <LiveTerminalOutput
                  command={pickString(entry.input, "command")}
                  streamId={entry.activity.toolCallId}
                  streamToken={streamToken}
                  step={stepNumber}
                  initialOutput={
                    typeof entry.output === "object" && entry.output !== null
                      ? (entry.output as {
                          stdout?: string;
                          stderr?: string;
                          exitCode?: number | null;
                          timedOut?: boolean;
                          killed?: boolean;
                          failedReason?: "timeout" | "killed" | "max_buffer" | "error";
                        })
                      : undefined
                  }
                />
              ) : (
                <TerminalOutput
                  command={pickString(entry.input, "command") ?? safeStringify(entry.input)}
                  step={stepNumber}
                  output={
                    entry.state === "output-error" && entry.errorText
                      ? { stderr: entry.errorText, exitCode: 1 }
                      : entry.output
                  }
                />
              )}
            </div>
          </div>
        )}
      </Disclosure>
      {approvalId && (
        <ApprovalControls approvalId={approvalId} onApproval={onApproval} />
      )}
    </div>
  );
}

function displayToolState(
  entry: ToolTraceEntry,
  runStatus: AntonRunStatus,
): ToolState {
  const effectiveState = effectiveToolState(entry);
  if (
    runStatus !== "running" &&
    entry.activity?.status === "running" &&
    (effectiveState === "input-streaming" || effectiveState === "input-available")
  ) {
    return "output-error";
  }
  return effectiveState;
}

function ToolTitle({
  title,
}: {
  title: { verb: string; target?: string };
}) {
  return (
    <span className="min-w-0 truncate text-[12.5px] leading-5 text-muted-foreground">
      {title.verb}
      {title.target && (
        <>
          {" "}
          <code className="rounded border border-border bg-input px-1.5 py-px font-mono text-[10.5px] leading-4 text-muted-foreground">
            {title.target}
          </code>
        </>
      )}
    </span>
  );
}
function ApprovalControls({
  approvalId,
  onApproval,
}: {
  approvalId: string;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        data-approval-action="approve"
        className="inline-flex size-5 items-center justify-center rounded hover:bg-emerald-500/15"
        title="Approve"
        onClick={(e) => {
          e.stopPropagation();
          onApproval({ id: approvalId, approved: true });
        }}
      >
        <CheckCircle2 className="size-3.5 text-emerald-400" />
      </button>
      <button
        type="button"
        data-approval-action="deny"
        className="inline-flex size-5 items-center justify-center rounded hover:bg-destructive/15"
        title="Deny"
        onClick={(e) => {
          e.stopPropagation();
          onApproval({ id: approvalId, approved: false });
        }}
      >
        <XCircle className="size-3.5 text-destructive" />
      </button>
    </span>
  );
}
