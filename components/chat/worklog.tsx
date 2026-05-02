"use client";

import { useState } from "react";
import { getToolName, isToolUIPart, type ChatAddToolApproveResponseFunction } from "ai";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Loader2,
  TerminalSquare,
  X,
  XCircle,
} from "lucide-react";

import type { AntonUIMessage } from "@/src/agent/loop";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DiffView } from "./diff-view";

type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

export type WorklogEntry = {
  id: string;
  sourceMessageId: string;
  name: string;
  state: ToolState;
  input: unknown;
  output: unknown;
  errorText: string | undefined;
  approvalId: string | undefined;
};

interface WorklogProps {
  messages: AntonUIMessage[];
  onApproval: ChatAddToolApproveResponseFunction;
  className?: string;
  onClose?: () => void;
}

export function Worklog({
  messages,
  onApproval,
  className,
  onClose,
}: WorklogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const entries = getWorklogEntries(messages);
  const latest = entries.at(-1);
  const selected =
    entries.find((entry) => entry.id === selectedId) ?? latest ?? null;

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-l border-border bg-card/35",
        className,
      )}
      aria-label="Worklog"
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <TerminalSquare className="size-3.5 text-muted-foreground" />
          Worklog
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {entries.length}
          </span>
          {onClose && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onClose}
              aria-label="Close worklog"
            >
              <X />
            </Button>
          )}
        </div>
      </header>

      {entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          Tool activity will appear here when Anton reads, searches, edits, or
          runs commands.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ol className="border-b border-border px-2 py-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <WorklogRow
                  entry={entry}
                  active={entry.id === selected?.id}
                  onSelect={() => setSelectedId(entry.id)}
                />
              </li>
            ))}
          </ol>
          {selected && (
            <WorklogDetail entry={selected} onApproval={onApproval} />
          )}
        </div>
      )}
    </aside>
  );
}

export function getWorklogEntries(messages: AntonUIMessage[]): WorklogEntry[] {
  const entries: WorklogEntry[] = [];
  for (const message of messages) {
    message.parts.forEach((part, index) => {
      if (!isToolUIPart(part)) return;
      const state = part.state as ToolState;
      entries.push({
        id: `${message.id}:${index}`,
        sourceMessageId: message.id,
        name: String(getToolName(part)),
        state,
        input: "input" in part ? part.input : undefined,
        output: "output" in part ? part.output : undefined,
        errorText: "errorText" in part ? part.errorText : undefined,
        approvalId:
          state === "approval-requested" && "approval" in part && part.approval
            ? part.approval.id
            : undefined,
      });
    });
  }
  return entries;
}

function WorklogRow({
  entry,
  active,
  onSelect,
}: {
  entry: WorklogEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const state = stateMeta(entry.state);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid w-full grid-cols-[0.875rem_1fr] gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors",
        active ? "bg-accent/70" : "hover:bg-accent/40",
      )}
      aria-pressed={active}
    >
      <state.Icon
        className={cn("mt-0.5 size-3", state.iconClass)}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-[11px] text-foreground">
            {entry.name}
          </span>
          <span className={cn("shrink-0 text-[10px]", state.textClass)}>
            {state.label}
          </span>
        </div>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {previewInput(entry.input)}
        </p>
      </div>
    </button>
  );
}

function WorklogDetail({
  entry,
  onApproval,
}: {
  entry: WorklogEntry;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const state = stateMeta(entry.state);
  const showWriteDiff =
    entry.name === "write_file" &&
    entry.state === "output-available" &&
    isOkWriteFileOutput(entry.output) &&
    pickString(entry.input, "content") !== undefined;

  return (
    <section className="space-y-2.5 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <state.Icon className={cn("size-3.5", state.iconClass)} />
            <span>{state.label}</span>
          </div>
          <h2 className="mt-0.5 truncate font-mono text-xs font-semibold">
            {entry.name}
          </h2>
        </div>
        {entry.state === "approval-requested" && entry.approvalId && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className="inline-flex items-center justify-center size-6 rounded hover:bg-emerald-500/15"
              title="Approve"
              onClick={() =>
                onApproval({ id: entry.approvalId as string, approved: true })
              }
            >
              <CheckCircle2 className="size-4 text-emerald-400" />
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center size-6 rounded hover:bg-destructive/15"
              title="Deny"
              onClick={() =>
                onApproval({ id: entry.approvalId as string, approved: false })
              }
            >
              <XCircle className="size-4 text-destructive" />
            </button>
          </div>
        )}
      </div>

      <LogBlock title="Input">{safeStringify(entry.input)}</LogBlock>

      {showWriteDiff ? (
        <DiffView
          previous={(entry.output as WriteFileOkOutput).previousContent ?? ""}
          next={pickString(entry.input, "content") ?? ""}
          newFile={(entry.output as WriteFileOkOutput).existed === false}
        />
      ) : entry.state === "output-error" && entry.errorText ? (
        <LogBlock title="Error" tone="error">
          {entry.errorText}
        </LogBlock>
      ) : entry.output !== undefined ? (
        <LogBlock title="Output">{safeStringify(entry.output)}</LogBlock>
      ) : null}
    </section>
  );
}

function LogBlock({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "error";
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div
        className={cn(
          "text-[10px] font-medium uppercase text-muted-foreground",
          tone === "error" && "text-destructive",
        )}
      >
        {title}
      </div>
      <pre className="max-h-56 overflow-auto rounded-md bg-background/70 p-2.5 font-mono text-[10px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  );
}

function stateMeta(state: ToolState) {
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

function previewInput(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const path = pickString(input, "path");
    const command = pickString(input, "command");
    const pattern = pickString(input, "pattern");
    return command ?? path ?? pattern ?? safeStringify(input);
  }
  return safeStringify(input);
}

type WriteFileOkOutput = {
  ok: true;
  path?: string;
  bytesWritten?: number;
  existed?: boolean;
  previousContent?: string;
  previousTruncated?: boolean;
};

function isOkWriteFileOutput(value: unknown): value is WriteFileOkOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: unknown }).ok === true
  );
}

function pickString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
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
