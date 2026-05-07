"use client";

import type { ChatAddToolApproveResponseFunction } from "ai";
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageCircleMore,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Disclosure } from "@/components/shared/disclosure";
import {
  type AntonActivityEvent,
  type AntonRunStatus,
} from "@/src/lib/trace";

import { formatDuration, type TraceRow, type StepGroup } from "./trace-data";
import { ToolTraceRow } from "./tool-trace-row";

export function TraceRowView({
  row,
  runStatus,
  onApproval,
}: {
  row: TraceRow;
  runStatus: AntonRunStatus;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  if (row.kind === "tool") {
    return (
      <ToolTraceRow
        entry={row.tool}
        runStatus={runStatus}
        onApproval={onApproval}
      />
    );
  }
  if (row.kind === "reasoning") {
    return (
      <ReasoningRow event={row.event} runStatus={runStatus} text={row.text} />
    );
  }
  if (row.kind === "progress") {
    return <ProgressRow text={row.text} />;
  }
  return <ActivityRow event={row.event} runStatus={runStatus} />;
}

function ActivityRow({
  event,
  runStatus,
}: {
  event: AntonActivityEvent;
  runStatus: AntonRunStatus;
}) {
  const displayEvent = displayEventForRun(event, runStatus);
  const meta = eventMeta(displayEvent);
  return (
    <div className="grid grid-cols-[0.875rem_minmax(0,1fr)] gap-2 py-0.5">
      <meta.Icon className={cn("mt-0.5 size-3.5", meta.iconClass)} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-foreground/85">
            {eventLabel(displayEvent)}
          </span>
          {displayEvent.durationMs !== undefined && (
            <span className="shrink-0 text-[10px]">
              {formatDuration(displayEvent.durationMs)}
            </span>
          )}
        </div>
        {displayEvent.summary && (
          <p className="truncate font-mono text-[10px]">
            {displayEvent.summary}
          </p>
        )}
      </div>
    </div>
  );
}

export function InlineReasoningRow({
  event,
  runStatus,
  text,
}: {
  event: AntonActivityEvent | undefined;
  runStatus: AntonRunStatus;
  text: string;
}) {
  const displayEvent = event ? displayEventForRun(event, runStatus) : undefined;
  const running = displayEvent?.status === "running";
  return (
    <div className="flex gap-2 py-1 text-xs text-foreground/70">
      {running ? (
        <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-sky-400" />
      ) : (
        <Brain className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
      )}
      <p className="whitespace-pre-wrap leading-relaxed text-foreground/70 italic font-mono text-[10px]">
        {text}
      </p>
    </div>
  );
}

function ReasoningRow({
  event,
  runStatus,
  text,
}: {
  event: AntonActivityEvent | undefined;
  runStatus: AntonRunStatus;
  text: string;
}) {
  const displayEvent = event ? displayEventForRun(event, runStatus) : undefined;
  const running = displayEvent?.status === "running";
  return (
    <Disclosure
      className="py-0.5"
      trigger={({ open }) => (
        <span className="inline-grid max-w-full grid-cols-[0.875rem_auto_0.75rem] items-start gap-2 rounded px-0 py-0">
          {running ? (
            <Loader2 className="mt-0.5 size-3.5 animate-spin text-sky-400" />
          ) : (
            <Brain className="mt-0.5 size-3.5 text-muted-foreground" />
          )}
          <span className="truncate text-foreground/85">
            {displayEvent?.durationMs !== undefined
              ? `Thought for ${formatDuration(displayEvent.durationMs)}`
              : running
                ? "Thinking"
                : "Thought"}
          </span>
          {open ? (
            <ChevronDown className="mt-0.5 size-3" />
          ) : (
            <ChevronRight className="mt-0.5 size-3" />
          )}
        </span>
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <pre className="ml-5 mt-1 max-h-40 overflow-y-auto pr-2 font-mono text-[10px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
          {text}
        </pre>
      </div>
    </Disclosure>
  );
}

function ProgressRow({ text }: { text: string }) {
  return (
    <div className="grid grid-cols-[0.875rem_minmax(0,1fr)] gap-2 py-0.5">
      <MessageCircleMore className="mt-0.5 size-3.5 text-muted-foreground" />
      <p className="min-w-0 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-foreground/75">
        {text}
      </p>
    </div>
  );
}

export function StepGroupView({
  group,
  runStatus,
  onApproval,
}: {
  group: StepGroup;
  runStatus: AntonRunStatus;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const hasPendingApproval = group.toolRows.some(
    (row) => row.kind === "tool" && row.tool.state === "approval-requested",
  );
  return (
    <Disclosure
      className="py-0.5"
      forceOpen={hasPendingApproval}
      trigger={({ open }) => (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded px-0 py-0 text-[11px] text-muted-foreground/80 hover:text-foreground/80">
          <span className="truncate">{group.summary}</span>
          {open ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
        </span>
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <ol className="mt-1 space-y-0">
          {group.toolRows.map((row) =>
            row.kind === "tool" ? (
              <li key={row.id}>
                <ToolTraceRow
                  entry={row.tool}
                  runStatus={runStatus}
                  onApproval={onApproval}
                />
              </li>
            ) : null,
          )}
        </ol>
      </div>
    </Disclosure>
  );
}

function eventLabel(event: AntonActivityEvent): string {
  return event.label;
}

function displayEventForRun(
  event: AntonActivityEvent,
  runStatus: AntonRunStatus,
): AntonActivityEvent {
  if (event.status !== "running" || runStatus === "running") return event;
  return {
    ...event,
    status: runStatus === "completed" ? "completed" : "error",
  };
}

function eventMeta(event: AntonActivityEvent) {
  if (event.status === "running") {
    return {
      Icon: Loader2,
      iconClass: "animate-spin text-sky-400",
    };
  }
  if (event.status === "error" || event.kind === "error") {
    return { Icon: AlertCircle, iconClass: "text-destructive" };
  }
  return { Icon: CheckCircle2, iconClass: "text-emerald-400" };
}
