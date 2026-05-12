"use client";

import { useState } from "react";
import type { ChatAddToolApproveResponseFunction } from "ai";
import {
  CheckCircle2,
  TerminalSquare,
  X,
  XCircle,
} from "lucide-react";

import {
  getToolTraceEntries,
  getApprovalMetadata,
  type AntonUIMessage,
  type ToolTraceEntry,
} from "@/src/lib/trace";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DiffView } from "./diff-view";
import {
  isOkWriteFileOutput,
  isOkEditFileOutput,
  effectiveToolState,
  pickString,
  previewToolInput,
  riskCategoryBadge,
  safeStringify,
  toolStateMeta,
  type WriteFileOkOutput,
} from "./tool-display";
import { TerminalOutput } from "./terminal-output";
import { LiveTerminalOutput } from "./live-terminal";
import { ApprovalDetails } from "./approval-details";

export type WorklogEntry = ToolTraceEntry;

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
  return getToolTraceEntries(messages);
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
  const state = toolStateMeta(effectiveToolState(entry));
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
          {state.label.length > 0 && (
            <span className={cn("shrink-0 text-[10px]", state.textClass)}>
              {state.label}
            </span>
          )}
        </div>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {previewToolInput(entry.input)}
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
  const state = toolStateMeta(effectiveToolState(entry));
  const showWriteDiff =
    entry.name === "write_file" &&
    entry.state === "output-available" &&
    isOkWriteFileOutput(entry.output) &&
    pickString(entry.input, "content") !== undefined;
  const editOutput = isOkEditFileOutput(entry.output) ? entry.output : undefined;
  const showEditDiff =
    entry.name === "edit_file" &&
    entry.state === "output-available" &&
    typeof editOutput?.previousContent === "string" &&
    typeof editOutput.nextContent === "string";
  const streamToken = pickString(entry.activity?.details, "streamToken");
  const approvalMeta =
    entry.state === "approval-requested"
      ? getApprovalMetadata(entry)
      : undefined;

  return (
    <section className="space-y-2.5 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <state.Icon className={cn("size-3.5", state.iconClass)} />
            {state.label.length > 0 && <span>{state.label}</span>}
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
        {approvalMeta && (
          <div className="flex flex-wrap items-center gap-1">
            {approvalMeta.riskCategories.map((cat) => {
              const badge = riskCategoryBadge(cat);
              return (
                <span
                  key={cat}
                  className={cn(
                    "rounded px-1.5 py-px font-mono text-[10px] uppercase",
                    badge.baseClass,
                  )}
                >
                  {badge.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {approvalMeta && (
        <ApprovalDetails approval={approvalMeta} />
      )}

      {approvalMeta?.diffPreview && (
        <DiffView
          previous={approvalMeta.diffPreview.previous}
          next={approvalMeta.diffPreview.next}
          newFile={approvalMeta.diffPreview.previous.length === 0}
        />
      )}

      {entry.name !== "bash" && (
        <LogBlock title="Input">{safeStringify(entry.input)}</LogBlock>
      )}

      {showWriteDiff ? (
        <DiffView
          previous={(entry.output as WriteFileOkOutput).previousContent ?? ""}
          next={pickString(entry.input, "content") ?? ""}
          newFile={(entry.output as WriteFileOkOutput).existed === false}
        />
      ) : showEditDiff ? (
        <DiffView
          previous={editOutput?.previousContent ?? ""}
          next={editOutput?.nextContent ?? ""}
        />
      ) : entry.name === "bash" && entry.activity?.status === "running" && entry.activity?.toolCallId ? (
        <LiveTerminalOutput
          command={pickString(entry.input, "command")}
          streamId={entry.activity.toolCallId}
          streamToken={streamToken}
          initialOutput={
            typeof entry.output === "object" && entry.output !== null
              ? (entry.output as {
                  stdout?: string;
                  stderr?: string;
                  exitCode?: number | null;
                  timedOut?: boolean;
                  killed?: boolean;
                  failedReason?: "timeout" | "killed" | "max_buffer" | "error";
                })
              : undefined
          }
        />
      ) : entry.name === "bash" ? (
        <TerminalOutput
          command={pickString(entry.input, "command") ?? safeStringify(entry.input)}
          output={
            entry.state === "output-error" && entry.errorText
              ? { stderr: entry.errorText, exitCode: 1 }
              : entry.output
          }
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
