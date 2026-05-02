"use client";

import { useEffect, useRef, useState } from "react";
import {
  getToolName,
  isToolUIPart,
  type ChatAddToolApproveResponseFunction,
} from "ai";
import {
  Check,
  CheckCircle2,
  Copy,
  ChevronDown,
  ChevronRight,
  Loader2,
  TerminalSquare,
  XCircle,
} from "lucide-react";

import type { AntonUIMessage } from "@/src/agent/loop";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

interface MessageListProps {
  messages: AntonUIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  onApproval: ChatAddToolApproveResponseFunction;
}

export function MessageList({ messages, status, onApproval }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, status]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Start a session by asking Anton to inspect or change the selected
        workspace.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-3 py-3 sm:px-4 lg:px-6"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 pb-8">
        {messages.map((message) => (
          <MessageEvent
            key={message.id}
            message={message}
            onApproval={onApproval}
          />
        ))}
        {status !== "ready" && status !== "error" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-sky-400" />
            Anton is thinking
          </div>
        )}
      </div>
    </div>
  );
}

function MessageEvent({
  message,
  onApproval,
}: {
  message: AntonUIMessage;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const isUser = message.role === "user";
  const plainText = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n\n")
    .trim();

  return (
    <div
      className={cn(
          "group/msg flex flex-col gap-1",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "max-w-full text-xs break-words",
          isUser
            ? "max-w-[88%] rounded-md bg-card px-2.5 py-1.5 text-foreground ring-1 ring-border"
            : "w-full text-foreground",
        )}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            if (isUser) {
              return (
                <div key={i} className="whitespace-pre-wrap leading-normal">
                  {part.text}
                </div>
              );
            }
            return <Markdown key={i} className="text-xs">{part.text}</Markdown>;
          }
          if (isToolUIPart(part)) {
            return (
              <InlineToolEvent
                key={i}
                name={String(getToolName(part))}
                state={part.state as ToolState}
                input={"input" in part ? part.input : undefined}
                output={"output" in part ? part.output : undefined}
                errorText={"errorText" in part ? part.errorText : undefined}
                approvalId={
                  part.state === "approval-requested"
                    ? part.approval.id
                    : undefined
                }
                onApproval={onApproval}
              />
            );
          }
          return null;
        })}
      </div>
      {!isUser && plainText.length > 0 && (
        <CopyMessageButton text={plainText} />
      )}
    </div>
  );
}

type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

function InlineToolEvent({
  name,
  state,
  input,
  output,
  errorText,
  approvalId,
  onApproval,
}: {
  name: string;
  state: ToolState;
  input: unknown;
  output: unknown;
  errorText: string | undefined;
  approvalId: string | undefined;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const needsApproval = state === "approval-requested" && approvalId;
  return (
    <details className="group/tool my-1 text-xs text-muted-foreground">
      <summary
        className={cn(
          "inline-flex max-w-full cursor-pointer list-none items-center gap-1.5 rounded px-1 py-0.5 font-mono text-[11px] text-foreground select-none",
          "transition-colors hover:bg-card/40 [&::-webkit-details-marker]:hidden",
        )}
        aria-label={`${name} tool details`}
        onClick={(e) => {
          if (needsApproval) {
            const target = e.target as HTMLElement;
            if (target.closest("[data-approval-action]")) {
              e.preventDefault();
            }
          }
        }}
      >
        <TerminalSquare className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
        <span className="ml-auto shrink-0">
          {needsApproval ? (
            <span className="inline-flex items-center gap-0.5">
              <button
                type="button"
                data-approval-action="approve"
                className="inline-flex items-center justify-center size-5 rounded hover:bg-emerald-500/15"
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
                className="inline-flex items-center justify-center size-5 rounded hover:bg-destructive/15"
                title="Deny"
                onClick={(e) => {
                  e.stopPropagation();
                  onApproval({ id: approvalId, approved: false });
                }}
              >
                <XCircle className="size-3.5 text-destructive" />
              </button>
            </span>
          ) : (
            <>
              <ChevronRight className="size-3 opacity-0 transition-opacity group-hover/tool:opacity-100 group-focus-within/tool:opacity-100 group-open/tool:hidden" />
              <ChevronDown className="hidden size-3 opacity-0 transition-opacity group-hover/tool:opacity-100 group-focus-within/tool:opacity-100 group-open/tool:block group-open/tool:opacity-100" />
            </>
          )}
        </span>
      </summary>
      <div className="ml-5 mt-1 rounded-md bg-card/50 px-2.5 py-2 ring-1 ring-border/70">
        <p className="truncate font-mono text-[11px]">
          {previewInput(input)}
        </p>
        {state === "output-error" && errorText && (
          <p className="mt-1 line-clamp-2 text-destructive">{errorText}</p>
        )}
        {state === "output-available" && output !== undefined && (
          <p className="mt-1 line-clamp-2 font-mono text-[10px] text-muted-foreground">
            {safeStringify(output)}
          </p>
        )}
      </div>
    </details>
  );
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // noop
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/msg:opacity-100 focus:opacity-100"
      aria-label={copied ? "Copied" : "Copy message"}
    >
      {copied ? (
        <>
          <Check className="size-3" /> copied
        </>
      ) : (
        <>
          <Copy className="size-3" /> copy
        </>
      )}
    </button>
  );
}

function previewInput(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    for (const key of ["command", "path", "pattern", "slug", "task"]) {
      if (typeof record[key] === "string") return record[key];
    }
  }
  return safeStringify(input);
}

function safeStringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
