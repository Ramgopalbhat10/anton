"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ChatAddToolApproveResponseFunction } from "ai";
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Loader2,
  TerminalSquare,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  getActivityEvents,
  getReasoningTexts,
  getRunData,
  getToolTraceEntries,
  type AntonActivityEvent,
  type AntonRunStatus,
  type AntonUIMessage,
  type ToolTraceEntry,
} from "@/src/lib/trace";

const DISCLOSURE_ANIMATION =
  "overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out will-change-[max-height,opacity] motion-reduce:transition-none";

interface RunTraceAccordionProps {
  message: AntonUIMessage;
  status: "submitted" | "streaming" | "ready" | "error";
  onApproval: ChatAddToolApproveResponseFunction;
}

type TraceRow =
  | {
      id: string;
      order: number;
      kind: "activity";
      event: AntonActivityEvent;
    }
  | {
      id: string;
      order: number;
      kind: "reasoning";
      event?: AntonActivityEvent;
      text: string;
    }
  | {
      id: string;
      order: number;
      kind: "tool";
      tool: ToolTraceEntry;
    };

export function RunTraceAccordion({
  message,
  status,
  onApproval,
}: RunTraceAccordionProps) {
  const run = getRunData(message);
  const metadata = message.metadata;
  const isRunning =
    (run?.status ?? metadata?.status) === "running" &&
    (status === "submitted" || status === "streaming");
  const now = useTick(isRunning);
  const rows = useMemo(() => getTraceRows(message), [message]);
  const modelTurnSummary = useMemo(() => getModelTurnSummary(message), [message]);

  if (!run && rows.length === 0) return null;

  const startedAt = run?.startedAt ?? metadata?.startedAt;
  const durationMs =
    run?.durationMs ??
    metadata?.durationMs ??
    getTraceDurationMs(rows) ??
    (startedAt === undefined ? 0 : Math.max(0, now - startedAt));
  const runStatus = run?.status ?? metadata?.status ?? "completed";
  const header =
    runStatus === "running"
      ? `Working for ${formatDuration(durationMs)}`
      : runStatus === "completed"
        ? `Worked for ${formatDuration(durationMs)}`
        : `Stopped after ${formatDuration(durationMs)}`;

  return (
    <Disclosure
      className="mb-2 w-full text-xs text-muted-foreground"
      defaultOpen={isRunning}
      forceOpen={isRunning}
      trigger={({ open }) => (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-[11px]">
          {runStatus === "running" ? (
            <Loader2 className="size-3.5 animate-spin text-sky-400" />
          ) : runStatus === "completed" ? (
            <CheckCircle2 className="size-3.5 text-emerald-400" />
          ) : (
            <AlertCircle className="size-3.5 text-amber-400" />
          )}
          <span className="font-medium text-foreground/90" title={modelTurnSummary}>
            {header}
          </span>
          {open ? (
            <ChevronDown className="size-3 opacity-70" />
          ) : (
            <ChevronRight className="size-3 opacity-70" />
          )}
        </span>
      )}
    >
      <div className="min-h-0 overflow-hidden">
          <ol className="ml-2 mt-1 space-y-0 border-l border-border/70 pl-3">
            {rows.map((row) => (
              <li key={row.id}>
                <TraceRowView
                  row={row}
                  runStatus={runStatus}
                  onApproval={onApproval}
                />
              </li>
            ))}
          </ol>
      </div>
    </Disclosure>
  );
}

function TraceRowView({
  row,
  runStatus,
  onApproval,
}: {
  row: TraceRow;
  runStatus: AntonRunStatus;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  if (row.kind === "tool") {
    return <ToolRow entry={row.tool} onApproval={onApproval} />;
  }
  if (row.kind === "reasoning") {
    return (
      <ReasoningRow event={row.event} runStatus={runStatus} text={row.text} />
    );
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

function ReasoningRow({
  event,
  runStatus,
  text,
}: {
  event: AntonActivityEvent | undefined;
  runStatus: AntonRunStatus;
  text: string;
}) {
  const displayEvent = event
    ? displayEventForRun(event, runStatus)
    : undefined;
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

function ToolRow({
  entry,
  onApproval,
}: {
  entry: ToolTraceEntry;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const meta = toolStateMeta(entry.state);
  const approvalId =
    entry.state === "approval-requested" &&
    typeof entry.approvalId === "string"
      ? entry.approvalId
      : undefined;
  const needsApproval = approvalId !== undefined;
  const showDetails = entry.name === "bash";
  const title = toolTitle(entry);
  const preview = previewInput(entry.input);
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

function getTraceRows(message: AntonUIMessage): TraceRow[] {
  const activities = getActivityEvents(message);
  const reasoningTexts = getReasoningTexts(message);
  const reasoningActivities = activities.filter(
    (event) => event.kind === "reasoning",
  );
  const toolEntries = getToolTraceEntries([message]);
  const rows: TraceRow[] = [];

  for (const event of activities) {
    if (event.kind === "tool" || event.kind === "reasoning") continue;
    if (event.kind === "step") continue;
    rows.push({
      id: event.id,
      order: event.sequence,
      kind: "activity",
      event,
    });
  }

  if (reasoningActivities.length > 0) {
    reasoningActivities.forEach((event, index) => {
      const text = reasoningTexts[index] ?? reasoningTexts.join("\n\n");
      if (!text) return;
      rows.push({
        id: event.id,
        order: event.sequence,
        kind: "reasoning",
        event,
        text,
      });
    });
  } else {
    reasoningTexts.forEach((text, index) => {
      rows.push({
        id: `${message.id}:reasoning:${index}`,
        order: 200 + index,
        kind: "reasoning",
        text,
      });
    });
  }

  toolEntries.forEach((tool, index) => {
    rows.push({
      id: tool.id,
      order: tool.activity?.sequence ?? 500 + index,
      kind: "tool",
      tool,
    });
  });

  return rows.sort((a, b) => a.order - b.order);
}

function getTraceDurationMs(rows: TraceRow[]): number | undefined {
  const durations = rows
    .map((row) => {
      if (row.kind === "activity") return row.event.durationMs;
      if (row.kind === "reasoning") return row.event?.durationMs;
      return row.tool.activity?.durationMs;
    })
    .filter((duration): duration is number => duration !== undefined);
  if (durations.length === 0) return undefined;
  return durations.reduce((sum, duration) => sum + duration, 0);
}

function getModelTurnSummary(message: AntonUIMessage): string | undefined {
  const turns = getActivityEvents(message).filter(
    (event) => event.kind === "step",
  );
  if (turns.length === 0) return undefined;
  return `Model turns: ${turns
    .map((turn, index) => {
      const duration = turn.durationMs;
      return duration === undefined
        ? `${index + 1}`
        : `${index + 1} ${formatDuration(duration)}`;
    })
    .join(", ")}`;
}

function Disclosure({
  className,
  defaultOpen = false,
  forceOpen = false,
  disabled = false,
  trigger,
  children,
}: {
  className?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  disabled?: boolean;
  trigger: (state: { open: boolean }) => ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const effectiveOpen = forceOpen || open;

  useEffect(() => {
    const content = contentRef.current;
    const panel = content?.parentElement;
    if (!content || !panel) return;

    const updateHeight = () => {
      panel.style.setProperty(
        "--disclosure-height",
        `${content.scrollHeight}px`,
      );
    };
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(content);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [children]);

  if (disabled) {
    return <div className={className}>{trigger({ open: false })}</div>;
  }

  return (
    <div className={className}>
      <button
        type="button"
        className="block max-w-full cursor-pointer text-left select-none"
        aria-expanded={effectiveOpen}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger({ open: effectiveOpen })}
      </button>
      <div
        id={id}
        className={cn(
          DISCLOSURE_ANIMATION,
          effectiveOpen ? "opacity-100" : "opacity-0",
        )}
        style={{
          maxHeight: effectiveOpen ? "var(--disclosure-height, 0px)" : "0px",
        }}
      >
        <div ref={contentRef}>{children}</div>
      </div>
    </div>
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

function toolStateMeta(state: ToolTraceEntry["state"]) {
  switch (state) {
    case "input-streaming":
      return {
        label: "streaming",
        Icon: Loader2,
        iconClass: "animate-spin text-sky-400",
        textClass: "text-sky-400",
      };
    case "input-available":
      return {
        label: "running",
        Icon: Clock3,
        iconClass: "text-sky-400",
        textClass: "text-sky-400",
      };
    case "approval-requested":
      return {
        label: "approval",
        Icon: AlertCircle,
        iconClass: "text-amber-400",
        textClass: "text-amber-400",
      };
    case "approval-responded":
      return {
        label: "approved",
        Icon: CheckCircle2,
        iconClass: "text-muted-foreground",
        textClass: "text-muted-foreground",
      };
    case "output-available":
      return {
        label: "done",
        Icon: iconForTool,
        iconClass: "text-emerald-400",
        textClass: "text-emerald-400",
      };
    case "output-error":
      return {
        label: "error",
        Icon: XCircle,
        iconClass: "text-destructive",
        textClass: "text-destructive",
      };
    case "output-denied":
      return {
        label: "denied",
        Icon: XCircle,
        iconClass: "text-destructive",
        textClass: "text-destructive",
      };
  }
}

function iconForTool({ className }: { className?: string }) {
  return <TerminalSquare className={className} />;
}

function toolTitle(entry: ToolTraceEntry): { verb: string; target?: string } {
  const target = previewInput(entry.input);
  switch (entry.name) {
    case "bash":
      return { verb: "Ran", target };
    case "read_file":
      return { verb: "Read", target };
    case "glob":
      return { verb: "Listed", target };
    case "grep":
      return { verb: "Searched", target };
    case "write_file":
      return { verb: "Edited", target };
    default:
      return {
        verb: entry.activity?.label ?? entry.name,
        target: target.length > 0 ? target : undefined,
      };
  }
}

function previewInput(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    const command = pickString(record, "command");
    const path = pickString(record, "path");
    const pattern = pickString(record, "pattern");
    if (command) return command;
    if (path) return path;
    if (pattern) return pattern;
  }
  return safeStringify(input);
}

function pickString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function safeStringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}
