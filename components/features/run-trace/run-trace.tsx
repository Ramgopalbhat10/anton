"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChatAddToolApproveResponseFunction } from "ai";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";

import {
  getAssistantTextDisplay,
  getMessageRunDurationMs,
  getRunData,
  type AntonUIMessage,
  type AntonRunStatus,
} from "@/src/lib/trace";
import { Disclosure } from "@/components/shared/disclosure";

import {
  formatDuration,
  getModelTurnSummary,
  getTraceRows,
  groupTraceRowsByStep,
  type TodoTraceDisplay,
} from "./trace-data";
import { StepGroupView, TraceRowView } from "./trace-rows";

function buildInterleaved(
  rows: ReturnType<typeof getTraceRows>,
  stepGroups: ReturnType<typeof groupTraceRowsByStep>,
): ({ kind: "row"; row: ReturnType<typeof getTraceRows>[number] } | { kind: "group"; group: ReturnType<typeof groupTraceRowsByStep>[number] })[] {
  const items: ({ kind: "row"; row: ReturnType<typeof getTraceRows>[number]; order: number } | { kind: "group"; group: ReturnType<typeof groupTraceRowsByStep>[number]; order: number })[] = [];
  for (const row of rows) {
    if (row.kind === "tool") continue;
    items.push({ kind: "row", row, order: row.order });
  }
  for (const group of stepGroups) {
    items.push({ kind: "group", group, order: group.order });
  }
  items.sort((a, b) => a.order - b.order);
  return items;
}

interface RunTraceAccordionProps {
  message: AntonUIMessage;
  status: "submitted" | "streaming" | "ready" | "error";
  todoDisplay?: TodoTraceDisplay;
  onApproval: ChatAddToolApproveResponseFunction;
}

export function RunTraceAccordion({
  message,
  status,
  todoDisplay,
  onApproval,
}: RunTraceAccordionProps) {
  const run = getRunData(message);
  const metadata = message.metadata;
  const transportRunning = status === "submitted" || status === "streaming";
  const runStatus = effectiveRunStatus(
    run?.status ?? metadata?.status,
    transportRunning,
  );
  const isRunning = runStatus === "running";

  const pendingApproval = useMemo(() => messageHasPendingApproval(message), [message]);
  const hasFinalResponseText = useMemo(
    () => !isRunning && getAssistantTextDisplay(message).finalText.length > 0,
    [isRunning, message],
  );

  const forceOpen = pendingApproval;
  const inlineTraceDefaultOpen = !isRunning && !hasFinalResponseText;

  const now = useTick(isRunning);
  const modelTurnSummary = useMemo(() => getModelTurnSummary(message), [message]);

  if (!run && !messageHasTracePayload(message)) return null;

  const startedAt = run?.startedAt ?? metadata?.startedAt;
  const durationMs =
    getMessageRunDurationMs(message, now) ??
    (startedAt === undefined ? 0 : Math.max(0, now - startedAt));
  const header =
    pendingApproval
      ? "Waiting for approval"
      : runStatus === "running"
      ? `Working for ${formatDuration(durationMs)}`
      : runStatus === "completed"
        ? `Worked for ${formatDuration(durationMs)}`
        : `Stopped after ${formatDuration(durationMs)}`;

  return (
    <Disclosure
      className="mb-2 w-full text-xs text-muted-foreground"
      defaultOpen={inlineTraceDefaultOpen}
      forceOpen={forceOpen}
      lazyMount
      trigger={({ open }) => (
        <span className="inline-flex max-w-full items-center gap-2 rounded px-1 py-0.5">
          {pendingApproval ? (
            <AlertCircle className="size-3.5 text-warning" />
          ) : runStatus === "running" ? (
            <Loader2 className="size-3.5 animate-spin text-info" />
          ) : runStatus === "completed" ? (
            <CheckCircle2 className="size-3.5 text-success" />
          ) : (
            <AlertCircle className="size-3.5 text-warning" />
          )}
          <span
            className="text-[13px] font-medium text-muted-foreground"
            title={modelTurnSummary}
          >
            {header}
          </span>
          {open ? (
            <ChevronDown className="size-3 text-muted-foreground/70" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground/70" />
          )}
        </span>
      )}
    >
      {() => (
        <RunTraceAccordionBody
          message={message}
          todoDisplay={todoDisplay}
          runStatus={runStatus}
          onApproval={onApproval}
        />
      )}
    </Disclosure>
  );
}

function RunTraceAccordionBody({
  message,
  todoDisplay,
  runStatus,
  onApproval,
}: {
  message: AntonUIMessage;
  todoDisplay?: TodoTraceDisplay;
  runStatus: AntonRunStatus;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const rows = useMemo(
    () => getTraceRows(message, todoDisplay),
    [message, todoDisplay],
  );
  const stepGroups = useMemo(
    () => groupTraceRowsByStep(message, rows),
    [message, rows],
  );

  if (rows.length === 0) return null;

  return (
    <div className="min-h-0 overflow-hidden">
      <div className="ml-[7px] mt-2 space-y-1 border-l-2 border-border py-0.5 pl-4">
        {buildInterleaved(rows, stepGroups).map((item) =>
          item.kind === "group" ? (
            <StepGroupView
              key={`step-${item.group.stepNumber}`}
              group={item.group}
              runStatus={runStatus}
              onApproval={onApproval}
            />
          ) : (
            <div key={item.row.id}>
              <TraceRowView
                row={item.row}
                runStatus={runStatus}
                onApproval={onApproval}
              />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function messageHasTracePayload(message: AntonUIMessage): boolean {
  return message.parts.some((part) => {
    if (
      part.type === "reasoning" ||
      part.type === "data-run" ||
      part.type === "data-activity" ||
      part.type === "data-todos"
    ) {
      return true;
    }
    return "toolCallId" in part && typeof part.toolCallId === "string";
  });
}

function messageHasPendingApproval(message: AntonUIMessage): boolean {
  return message.parts.some(
    (part) =>
      "state" in part &&
      part.state === "approval-requested" &&
      "toolCallId" in part &&
      typeof part.toolCallId === "string",
  );
}

function effectiveRunStatus(
  status: AntonRunStatus | undefined,
  transportRunning: boolean,
): AntonRunStatus {
  if (status === "running" && !transportRunning) return "aborted";
  return status ?? "completed";
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
