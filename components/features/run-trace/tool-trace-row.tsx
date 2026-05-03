"use client";

import type { ChatAddToolApproveResponseFunction } from "ai";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Disclosure } from "@/components/shared/disclosure";
import type { ToolTraceEntry } from "@/src/lib/trace";

import { formatDuration, toolTitle } from "./trace-data";
import {
  previewToolInput,
  safeStringify,
  traceToolStateMeta,
} from "./tool-display";

export function ToolTraceRow({
  entry,
  onApproval,
}: {
  entry: ToolTraceEntry;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const meta = traceToolStateMeta(entry.state);
  const approvalId =
    entry.state === "approval-requested" &&
    typeof entry.approvalId === "string"
      ? entry.approvalId
      : undefined;
  const needsApproval = approvalId !== undefined;
  const showDetails = entry.name === "bash";
  const title = toolTitle(entry);
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
              {entry.name !== "bash" && (
                <span className={cn("shrink-0 text-[10px]", meta.textClass)}>
                  {meta.label}
                </span>
              )}
              {approvalId && (
                <ApprovalControls approvalId={approvalId} onApproval={onApproval} />
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
          </span>
        </span>
      )}
    >
      {showDetails && (
        <div className="min-h-0 overflow-hidden">
          <div className="ml-5 mt-1 rounded-md bg-card/50 px-2.5 py-2 ring-1 ring-border/70">
            <LogLine title="Input">{safeStringify(entry.input)}</LogLine>
            {entry.state === "output-error" && entry.errorText ? (
              <LogLine title="Error" tone="error">
                {entry.errorText}
              </LogLine>
            ) : entry.output !== undefined ? (
              <LogLine title="Output">{safeStringify(entry.output)}</LogLine>
            ) : null}
          </div>
        </div>
      )}
    </Disclosure>
  );
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

function LogLine({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "error";
  children: ReactNode;
}) {
  return (
    <div className="space-y-1 py-1">
      <div
        className={cn(
          "text-[10px] font-medium uppercase text-muted-foreground",
          tone === "error" && "text-destructive",
        )}
      >
        {title}
      </div>
      <pre className="max-h-32 overflow-auto font-mono text-[10px] leading-relaxed text-foreground/85 whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  );
}
