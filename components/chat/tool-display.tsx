"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Loader2,
  TerminalSquare,
  XCircle,
} from "lucide-react";

import type { ToolTraceEntry, ToolState } from "@/src/lib/trace";

export type WriteFileOkOutput = {
  ok: true;
  path?: string;
  bytesWritten?: number;
  existed?: boolean;
  previousContent?: string;
  previousTruncated?: boolean;
};

export function isOkWriteFileOutput(
  value: unknown,
): value is WriteFileOkOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: unknown }).ok === true
  );
}

export function pickString(
  value: unknown,
  key: string,
): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  return typeof record[key] === "string" ? record[key] : undefined;
}

export function previewToolInput(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    return (
      pickString(input, "command") ??
      pickString(input, "path") ??
      pickString(input, "pattern") ??
      pickString(input, "slug") ??
      pickString(input, "task") ??
      safeStringify(input)
    );
  }
  return safeStringify(input);
}

export function safeStringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function toolStateMeta(state: ToolState) {
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
        Icon: CheckCircle2,
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

export function toolStateBadge(state: ToolState): {
  label: string;
  tone: string;
} {
  switch (state) {
    case "input-streaming":
      return {
        label: "calling...",
        tone: "bg-secondary text-muted-foreground",
      };
    case "input-available":
      return {
        label: "running...",
        tone: "bg-secondary text-muted-foreground",
      };
    case "approval-requested":
      return {
        label: "needs approval",
        tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
      };
    case "approval-responded":
      return {
        label: "approved",
        tone: "bg-secondary text-muted-foreground",
      };
    case "output-available":
      return {
        label: "done",
        tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      };
    case "output-error":
      return {
        label: "error",
        tone: "bg-destructive/15 text-destructive",
      };
    case "output-denied":
      return {
        label: "denied",
        tone: "bg-destructive/15 text-destructive",
      };
  }
}

export function traceToolStateMeta(state: ToolTraceEntry["state"]) {
  const meta = toolStateMeta(state);
  if (state !== "output-available") return meta;
  return {
    ...meta,
    Icon: iconForTool,
  };
}

function iconForTool({ className }: { className?: string }) {
  return <TerminalSquare className={className} />;
}
