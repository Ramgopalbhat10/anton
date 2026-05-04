"use client";

import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";

import {
  getRunData,
  getToolTraceEntries,
  type AntonUIMessage,
} from "@/src/lib/trace";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { RunTraceAccordion } from "@/components/features/run-trace/run-trace";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

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
            status={status}
            onApproval={onApproval}
          />
        ))}
      </div>
    </div>
  );
}

function MessageEvent({
  message,
  status,
  onApproval,
}: {
  message: AntonUIMessage;
  status: "submitted" | "streaming" | "ready" | "error";
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const isUser = message.role === "user";
  const plainText = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n\n")
    .trim();
  const fallbackText = !isUser && plainText.length === 0
    ? toolResultFallbackText(message)
    : "";
  const finalText = plainText || fallbackText;
  const responseTime = !isUser ? messageDisplayTime(message) : undefined;
  const metrics = !isUser ? messageMetrics(message) : undefined;

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
            onApproval={onApproval}
          />
        )}
        {message.parts.map((part, i) => {
          if (part.type !== "text") return null;
          if (isUser) {
            return (
              <div key={i} className="whitespace-pre-wrap leading-normal">
                {part.text}
              </div>
            );
          }
          return <Markdown key={i} className="text-xs">{part.text}</Markdown>;
        })}
        {!isUser && plainText.length === 0 && fallbackText.length > 0 && (
          <Markdown className="text-xs">{fallbackText}</Markdown>
        )}
      </div>
      {!isUser && finalText.length > 0 && (
        <MessageActions
          text={finalText}
          responseTime={responseTime}
          metrics={metrics}
        />
      )}
    </div>
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
  const timestamp = metadata?.finishedAt ?? metadata?.startedAt ?? run?.finishedAt ?? run?.startedAt;
  if (typeof timestamp !== "number") return undefined;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

type ResponseMetrics = {
  model?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
};

function messageMetrics(message: AntonUIMessage): ResponseMetrics {
  const metadata = message.metadata;
  const run = getRunData(message);
  return {
    model: metadata?.model ?? run?.model,
    durationMs: metadata?.durationMs ?? run?.durationMs,
    inputTokens: metadata?.inputTokens ?? run?.inputTokens,
    outputTokens: metadata?.outputTokens ?? run?.outputTokens,
    totalTokens: metadata?.totalTokens ?? run?.totalTokens,
    costUsd:
      readNumber(metadata, "costUsd") ??
      readNumber(metadata, "cost") ??
      readNumber(run, "costUsd") ??
      readNumber(run, "cost"),
  };
}

function readNumber(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "number" && Number.isFinite(entry) ? entry : undefined;
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
      <HoverCardContent className="w-56 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
          <Cpu className="size-3" />
          {modelName}
        </div>
        <div className="space-y-1.5 text-[10px]">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Hash className="size-3" />
            <span>Total</span>
            <span className="ml-auto font-mono text-foreground">{formatNumber(metrics.totalTokens)}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <ArrowDownToLine className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">In</span>
              <span className="ml-auto font-mono text-foreground">{formatNumber(metrics.inputTokens)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ArrowUpFromLine className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">Out</span>
              <span className="ml-auto font-mono text-foreground">{formatNumber(metrics.outputTokens)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <DollarSign className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">Cost</span>
              <span className="ml-auto font-mono text-foreground">{formatCost(metrics.costUsd)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">Duration</span>
              <span className="ml-auto font-mono text-foreground">{formatDuration(metrics.durationMs)}</span>
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "—" : new Intl.NumberFormat().format(value);
}

function formatCost(value: number | undefined): string {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "symbol",
    maximumFractionDigits: 4,
  })
    .format(value)
    .replace("US$", "$");
}

function formatDuration(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`;
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
