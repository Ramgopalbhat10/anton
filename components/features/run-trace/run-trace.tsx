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

import { getRunData, type AntonUIMessage } from "@/src/lib/trace";
import { Disclosure } from "@/components/shared/disclosure";

import {
  formatDuration,
  getModelTurnSummary,
  getTraceDurationMs,
  getTraceRows,
  groupTraceRowsByStep,
} from "./trace-data";
import { InlineReasoningRow, StepGroupView, TraceRowView } from "./trace-rows";

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
  onApproval: ChatAddToolApproveResponseFunction;
}

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

  const hasResponseText = useMemo(
    () => message.parts.some((p) => p.type === "text" && (p as { text: string }).text.trim().length > 0),
    [message.parts],
  );

  const showInline = isRunning && !hasResponseText;

  const now = useTick(isRunning);
  const rows = useMemo(() => getTraceRows(message), [message]);
  const stepGroups = useMemo(() => groupTraceRowsByStep(message, rows), [message, rows]);
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

  if (showInline) {
    return (
      <div className="mb-2 w-full space-y-0 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 px-1 py-0.5 text-[11px]">
          <Loader2 className="size-3.5 animate-spin text-sky-400" />
          <span className="font-medium text-foreground/90">{header}</span>
        </div>
        <div className="ml-1 space-y-0.5 pl-1">
          {buildInterleaved(rows, stepGroups).map((item) =>
            item.kind === "group" ? (
              <StepGroupView
                key={`step-${item.group.stepNumber}`}
                group={item.group}
                onApproval={onApproval}
              />
            ) : item.row.kind === "reasoning" ? (
              <InlineReasoningRow
                key={item.row.id}
                event={item.row.event}
                runStatus={runStatus}
                text={item.row.text}
              />
            ) : (
              <TraceRowView
                key={item.row.id}
                row={item.row}
                runStatus={runStatus}
                onApproval={onApproval}
              />
            ),
          )}
        </div>
      </div>
    );
  }

  return (
    <Disclosure
      className="mb-2 w-full text-xs text-muted-foreground"
      defaultOpen={false}
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
        <div className="ml-2 mt-1 space-y-0 border-l border-border/70 pl-3">
          {buildInterleaved(rows, stepGroups).map((item) =>
            item.kind === "group" ? (
              <StepGroupView
                key={`step-${item.group.stepNumber}`}
                group={item.group}
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

function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}
