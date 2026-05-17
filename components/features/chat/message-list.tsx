"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatAddToolApproveResponseFunction } from "ai";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Clock,
  Copy,
  Cpu,
  DollarSign,
  Hash,
  Pencil,
  Play,
} from "lucide-react";

import {
  failedToolOutputMessage,
  getAssistantTextDisplay,
  getRunData,
  getToolTraceEntries,
  hasPendingToolApproval,
  type AntonUIMessage,
} from "@/src/lib/trace";
import type { ChatMode } from "@/src/lib/chat-modes";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  formatMetricCost,
  formatMetricDuration,
  formatMetricNumber,
  messageMetrics,
  type ResponseMetrics,
} from "./message-metrics";
import { RunTraceAccordion } from "@/components/features/run-trace/run-trace";
import { getTodoTraceDisplay } from "@/components/features/run-trace/trace-data";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

interface MessageListProps {
  messages: AntonUIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  recovering?: boolean;
  streamingResponseMode?: ChatMode | null;
  onApproval: ChatAddToolApproveResponseFunction;
  onAcceptPlan: (plan: string) => void;
  acceptPlanDisabled?: boolean;
}

export function MessageList({
  messages,
  status,
  recovering = false,
  streamingResponseMode = null,
  onApproval,
  onAcceptPlan,
  acceptPlanDisabled = false,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const todoDisplay = useMemo(() => getTodoTraceDisplay(messages), [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, status]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {emptyMessageListText(recovering)}
      </div>
    );
  }

  const latestMessage = messages.at(-1);
  const activeAssistantMessageId =
    latestMessage?.role === "assistant" ? latestMessage.id : undefined;

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
            status={
              message.id === activeAssistantMessageId ? status : "ready"
            }
            streamingResponseMode={
              message.id === activeAssistantMessageId
                ? streamingResponseMode
                : null
            }
            todoDisplay={todoDisplay}
            onApproval={onApproval}
            onAcceptPlan={onAcceptPlan}
            acceptPlanDisabled={acceptPlanDisabled}
          />
        ))}
      </div>
    </div>
  );
}

export function emptyMessageListText(recovering: boolean): string {
  return recovering
    ? "Loading session..."
    : "Start a session by asking Anton to inspect or change the selected workspace.";
}

function MessageEvent({
  message,
  status,
  streamingResponseMode,
  todoDisplay,
  onApproval,
  onAcceptPlan,
  acceptPlanDisabled,
}: {
  message: AntonUIMessage;
  status: "submitted" | "streaming" | "ready" | "error";
  streamingResponseMode: ChatMode | null;
  todoDisplay: ReturnType<typeof getTodoTraceDisplay>;
  onApproval: ChatAddToolApproveResponseFunction;
  onAcceptPlan: (plan: string) => void;
  acceptPlanDisabled: boolean;
}) {
  const isUser = message.role === "user";
  const streaming = status === "submitted" || status === "streaming";
  const responseKind =
    message.metadata?.responseKind ??
    (!isUser && streaming ? streamingResponseMode ?? undefined : undefined);
  const userText = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n\n")
    .trim();
  const assistantText = !isUser
    ? getAssistantTextDisplay(message, {
        progressOnly:
          responseKind !== "plan" && streaming,
      }).finalText
    : "";
  const pendingApproval = !isUser && hasPendingToolApproval(message);
  const failedToolText = !isUser ? toolFailureFallbackText(message) : "";
  const assistantFinal = !isUser && isAssistantMessageFinal(message);
  const fallbackText = !isUser &&
    assistantText.length === 0 &&
    failedToolText.length === 0 &&
    !pendingApproval &&
    assistantFinal
    ? toolResultFallbackText(message)
    : "";
  const responseText = isUser ? userText : assistantText || fallbackText;
  const responseTime = !isUser ? messageDisplayTime(message) : undefined;
  const metrics = !isUser ? messageMetrics(message) : undefined;
  const showActions =
    !isUser &&
    responseText.length > 0 &&
    !pendingApproval &&
    assistantFinal &&
    responseKind !== "plan";
  const showToolFailure =
    !isUser &&
    failedToolText.length > 0 &&
    assistantText.length === 0 &&
    !pendingApproval &&
    assistantFinal &&
    responseKind !== "plan";
  const showPlanCard =
    !isUser &&
    responseKind === "plan" &&
    responseText.length > 0 &&
    assistantFinal &&
    !streaming;

  return (
    <div
      className={cn(
        "group/msg flex flex-col gap-1",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "max-w-full text-xs wrap-break-word",
          isUser
            ? "max-w-[88%] rounded-md bg-card px-2.5 py-1.5 text-foreground ring-1 ring-border"
            : "w-full text-foreground",
        )}
      >
        {!isUser && (
          <RunTraceAccordion
            message={message}
            status={status}
            todoDisplay={todoDisplay}
            onApproval={onApproval}
          />
        )}
        {isUser ? (
          message.parts.map((part, i) => {
            if (part.type !== "text") return null;
            return (
              <div key={i} className="whitespace-pre-wrap leading-normal">
                {part.text}
              </div>
            );
          })
        ) : showPlanCard ? (
          <PlanMessageCard
            markdown={responseText}
            onAccept={onAcceptPlan}
            disabled={!assistantFinal || pendingApproval || acceptPlanDisabled}
          />
        ) : showToolFailure ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Tool failed: {failedToolText}
          </div>
        ) : responseKind === "plan" ? null
        : responseText.length > 0 ? (
          <Markdown className="text-xs">{responseText}</Markdown>
        ) : null}
      </div>
      {showActions && (
        <MessageActions
          text={responseText}
          responseTime={responseTime}
          metrics={metrics}
        />
      )}
    </div>
  );
}

function PlanMessageCard({
  markdown,
  disabled,
  onAccept,
}: {
  markdown: string;
  disabled: boolean;
  onAccept: (plan: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(markdown);
  const current = editing ? draft : markdown;

  return (
    <section className="overflow-hidden rounded-md bg-card/80 ring-1 ring-border">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <div className="min-w-0">
          <div className="flex h-5 items-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Plan
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              if (!editing) setDraft(markdown);
              setEditing((value) => !value);
            }}
          >
            <Pencil className="size-3" />
            {editing ? "Preview" : "Edit"}
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={disabled || current.trim().length === 0}
            onClick={() => onAccept(current.trim())}
          >
            <Play className="size-3" />
            Accept
          </Button>
        </div>
      </div>
      <div className="p-3">
        {editing ? (
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-72 resize-y font-mono text-xs leading-relaxed"
            aria-label="Edit plan markdown"
          />
        ) : (
          <Markdown className="text-xs">{current}</Markdown>
        )}
      </div>
    </section>
  );
}

function isAssistantMessageFinal(message: AntonUIMessage): boolean {
  const runStatus = getRunData(message)?.status ?? message.metadata?.status;
  return runStatus === undefined || runStatus !== "running";
}

function toolFailureFallbackText(message: AntonUIMessage): string {
  const entries = getToolTraceEntries([message]);
  const failed = entries.findLast((entry) => {
    return (
      entry.state === "output-error" ||
      isFailedToolOutput(entry.output)
    );
  });
  if (!failed) return "";
  return (
    failed.errorText ??
    failedToolOutputMessage(failed.output) ??
    `${failed.name} failed`
  );
}

function isFailedToolOutput(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    "ok" in output &&
    (output as { ok: unknown }).ok === false
  );
}

function toolResultFallbackText(message: AntonUIMessage): string {
  const entries = getToolTraceEntries([message]);
  const lastOutput = entries.findLast(
    (entry) => entry.state === "output-available" && entry.output !== undefined,
  );
  if (!lastOutput) return "";

  if (lastOutput.name === "bash") {
    return bashOutputFallback(lastOutput.output);
  }

  if (typeof lastOutput.output === "string") return lastOutput.output.trim();

  return "";
}

function bashOutputFallback(output: unknown): string {
  if (typeof output !== "object" || output === null) return "";
  const record = output as Record<string, unknown>;
  const stdout = typeof record.stdout === "string" ? record.stdout.trim() : "";
  const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
  if (stdout) return `\`${stdout}\``;
  if (stderr) return `\`${stderr}\``;
  const exitCode = record.exitCode;
  if (typeof exitCode === "number") return `Command exited with code ${exitCode}.`;
  return "";
}

function messageDisplayTime(message: AntonUIMessage): string | undefined {
  const metadata = message.metadata;
  const run = getRunData(message);
  const timestamp = run?.finishedAt ?? metadata?.finishedAt ?? run?.startedAt ?? metadata?.startedAt;
  if (typeof timestamp !== "number") return undefined;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function MessageActions({
  text,
  responseTime,
  metrics,
}: {
  text: string;
  responseTime?: string;
  metrics?: ResponseMetrics;
}) {
  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
      <CopyMessageButton text={text} />
      {metrics && <StatsHoverCard metrics={metrics} />}
      {responseTime && (
        <span className="px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
          {responseTime}
        </span>
      )}
    </div>
  );
}

function StatsHoverCard({ metrics }: { metrics: ResponseMetrics }) {
  const modelName = formatModelName(metrics.model);
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground focus:outline-none"
          aria-label="Response metrics"
        >
          <Cpu className="size-3" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-64 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
          <Cpu className="size-3" />
          {modelName}
        </div>
        <div className="space-y-1.5 text-[10px]">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Hash className="size-3" />
            <span>Total</span>
            <span className="ml-auto whitespace-nowrap font-mono text-foreground">{formatMetricNumber(metrics.totalTokens)}</span>
          </div>
          {metrics.effectiveTokens !== undefined && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Hash className="size-3" />
              <span>Effective</span>
              <span className="ml-auto whitespace-nowrap font-mono text-foreground">{formatMetricNumber(metrics.effectiveTokens)}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <ArrowDownToLine className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">In</span>
              <span className="ml-auto whitespace-nowrap font-mono text-foreground">{formatMetricNumber(metrics.inputTokens)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ArrowUpFromLine className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">Out</span>
              <span className="ml-auto whitespace-nowrap font-mono text-foreground">{formatMetricNumber(metrics.outputTokens)}</span>
            </div>
          </div>
          {(metrics.cachedInputTokens !== undefined ||
            metrics.cacheWriteTokens !== undefined) && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div className="flex items-center gap-1.5">
                <Hash className="size-3 text-muted-foreground" />
                <span className="text-muted-foreground">Cached</span>
                <span className="ml-auto whitespace-nowrap font-mono text-foreground">{formatMetricNumber(metrics.cachedInputTokens)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Hash className="size-3 text-muted-foreground" />
                <span className="text-muted-foreground">Write</span>
                <span className="ml-auto whitespace-nowrap font-mono text-foreground">{formatMetricNumber(metrics.cacheWriteTokens)}</span>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <DollarSign className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">Cost</span>
              <span className="ml-auto whitespace-nowrap font-mono text-foreground">{formatMetricCost(metrics.costUsd)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">Duration</span>
              <span className="ml-auto whitespace-nowrap font-mono text-foreground">{formatMetricDuration(metrics.durationMs)}</span>
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function formatModelName(value: string | undefined): string {
  if (!value) return "—";
  return value.split("/").at(-1) ?? value;
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
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground"
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
