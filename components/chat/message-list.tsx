"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatAddToolApproveResponseFunction } from "ai";
import { Check, Copy } from "lucide-react";

import {
  getToolTraceEntries,
  type AntonUIMessage,
} from "@/src/lib/trace";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { RunTraceAccordion } from "./run-trace";

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
        <CopyMessageButton text={finalText} />
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
