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
  previousHash?: string;
  nextHash?: string;
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

export type EditFileOkOutput = {
  ok: true;
  path?: string;
  bytesWritten?: number;
  previousContent?: string;
  nextContent?: string;
  previousHash?: string;
  nextHash?: string;
};

export function isOkEditFileOutput(
  value: unknown,
): value is EditFileOkOutput {
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
      pickStringArray(input, "paths") ??
      pickString(input, "sourcePath") ??
      pickString(input, "destinationPath") ??
      pickString(input, "message") ??
      pickString(input, "name") ??
      pickString(input, "ref") ??
      pickString(input, "pattern") ??
      pickString(input, "slug") ??
      pickString(input, "task") ??
      safeStringify(input)
    );
  }
  return safeStringify(input);
}

function pickStringArray(
  value: unknown,
  key: string,
): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const item = record[key];
  if (!Array.isArray(item)) return undefined;
  const strings = item.filter((entry): entry is string => typeof entry === "string");
  if (strings.length === 0) return undefined;
  return strings.join(", ");
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
        label: "",
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

export function effectiveToolState(entry: ToolTraceEntry): ToolState {
  if (entry.state === "output-available" && isFailedToolOutput(entry.output)) {
    return "output-error";
  }
  return entry.state;
}

export function isFailedToolOutput(output: unknown): boolean {
  if (typeof output !== "object" || output === null) return false;
  const record = output as Record<string, unknown>;
  if (record.ok === false) return true;
  if (record.timedOut === true) return true;
  if (
    typeof record.failedReason === "string" &&
    record.failedReason.length > 0
  ) {
    return true;
  }
  const exitCode = record.exitCode;
  return typeof exitCode === "number" && exitCode !== 0;
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
        label: "",
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

export function riskCategoryBadge(
  category: string,
): { label: string; baseClass: string } {
  switch (category) {
    case "read-only":
      return { label: "read", baseClass: "bg-secondary text-muted-foreground ring-1 ring-border" };
    case "write":
      return { label: "write", baseClass: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40" };
    case "delete":
      return { label: "delete", baseClass: "bg-red-500/15 text-red-300 ring-1 ring-red-500/40" };
    case "network":
      return { label: "network", baseClass: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40" };
    case "package-install":
      return { label: "install", baseClass: "bg-purple-500/15 text-purple-300 ring-1 ring-purple-500/40" };
    case "git":
      return { label: "git", baseClass: "bg-teal-500/15 text-teal-300 ring-1 ring-teal-500/40" };
    case "long-running-process":
      return { label: "long-run", baseClass: "bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/40" };
    case "external-integration":
      return { label: "external", baseClass: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/40" };
    default:
      return { label: category, baseClass: "bg-secondary text-muted-foreground ring-1 ring-border" };
  }
}
