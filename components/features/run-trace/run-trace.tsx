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
  hasFailedToolOutput,
  hasPendingToolApproval,
  type AntonUIMessage,
  type AntonRunStatus,
} from "@/src/lib/trace";
import { Disclosure } from "@/components/shared/disclosure";

import {
  formatDuration,
  getModelTurnSummary,
  getTraceDurationMs,
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
  const hasToolFailure = hasFailedToolOutput(message);
  const runStatus = effectiveRunStatus(
    run?.status ?? metadata?.status,
    transportRunning,
    hasToolFailure,
  );
  const isRunning = runStatus === "running";

  const pendingApproval = useMemo(
    () => hasPendingToolApproval(message),
    [message],
  );
  const hasFinalResponseText = useMemo(
    () => getAssistantTextDisplay(message).finalText.length > 0,
    [message],
  );

  const forceOpen = pendingApproval;

  const now = useTick(isRunning);
  const rows = useMemo(
    () => getTraceRows(message, todoDisplay),
    [message, todoDisplay],
  );
  const stepGroups = useMemo(() => groupTraceRowsByStep(message, rows), [message, rows]);
  const modelTurnSummary = useMemo(() => getModelTurnSummary(message), [message]);

  if (!run && rows.length === 0) return null;

  const startedAt = run?.startedAt ?? metadata?.startedAt;
  const durationMs =
    getMessageRunDurationMs(message, now) ??
    getTraceDurationMs(rows) ??
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
      defaultOpen={!hasFinalResponseText}
      forceOpen={forceOpen}
      trigger={({ open }) => (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-[11px]">
          {pendingApproval ? (
            <AlertCircle className="size-3.5 text-amber-400" />
          ) : runStatus === "running" ? (
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
        <div className="ml-2 mt-1 space-y-0 border-l border-border/70 pl-3">
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
    </Disclosure>
  );
}

function effectiveRunStatus(
  status: AntonRunStatus | undefined,
  transportRunning: boolean,
  hasToolFailure: boolean,
): AntonRunStatus {
  if (status === "running" && !transportRunning) return "aborted";
  if (hasToolFailure) return "error";
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
