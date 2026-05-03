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
} from "./trace-data";
import { TraceRowView } from "./trace-rows";

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

function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}
