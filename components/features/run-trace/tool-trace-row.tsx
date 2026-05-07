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

import { formatDuration, toolTitle } from "./trace-data";
import {
  pickString,
  previewToolInput,
  riskCategoryBadge,
  safeStringify,
  traceToolStateMeta,
} from "./tool-display";
import { TerminalOutput } from "./terminal-output";
import { LiveTerminalOutput } from "./live-terminal";

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
  const showDetails = entry.name === "bash";
  const streamToken = pickString(entry.activity?.details, "streamToken");
  const title = toolTitle(entry, runStatus);
  const preview = previewToolInput(entry.input);
  const showPreview = preview.length > 0 && preview !== title.target;
  return (
    <Disclosure
      className="py-0.5"
      disabled={needsApproval || !showDetails}
      trigger={({ open }) => (
        <span className="grid grid-cols-[0.875rem_minmax(0,1fr)] gap-2 rounded px-0 py-0">
          <meta.Icon className={cn("mt-0.5 size-3.5", meta.iconClass)} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <ToolTitle title={title} />
              {showDetails &&
                !needsApproval &&
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
              {approvalId && (
                <>
                  <ApprovalControls approvalId={approvalId} onApproval={onApproval} />
                </>
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
                <span className="shrink-0 text-[10px]">
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
              <span className="block text-[10px] text-muted-foreground">
                {approvalMeta.riskSummary}
                {approvalMeta.bashClassification &&
                  !approvalMeta.bashClassification.forbidden && (
                    <> &mdash; {approvalMeta.bashClassification.reason}</>
                  )}
              </span>
            )}
          </span>
        </span>
      )}
    >
      {showDetails && (
        <div className="min-h-0 overflow-hidden">
          <div className="ml-5 mt-1">
            {entry.name === "bash" &&
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
                        failedReason?: "timeout" | "killed" | "max_buffer" | "error";
                      })
                    : undefined
                }
              />
            ) : (
              <TerminalOutput
                command={pickString(entry.input, "command") ?? safeStringify(entry.input)}
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
  );
}

function displayToolState(
  entry: ToolTraceEntry,
  runStatus: AntonRunStatus,
): ToolState {
  if (
    runStatus !== "running" &&
    entry.activity?.status === "running" &&
    (entry.state === "input-streaming" || entry.state === "input-available")
  ) {
    return "output-error";
  }
  return entry.state;
}

function ToolTitle({
  title,
}: {
  title: { verb: string; target?: string };
}) {
  return (
    <span className="min-w-0 truncate text-foreground/85">
      {title.verb}
      {title.target && (
        <>
          {" "}
          <code className="rounded bg-card px-1 py-0.5 font-mono text-[10px] text-foreground/90">
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
