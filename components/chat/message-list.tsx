"use client";

import { useEffect, useRef } from "react";
import {
  getToolName,
  isToolUIPart,
  type ChatAddToolApproveResponseFunction,
} from "ai";
import type { AntonUIMessage } from "@/src/agent/loop";
import { cn } from "@/lib/utils";
import { ToolCard } from "./tool-card";

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
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Start a conversation with Anton.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onApproval={onApproval}
        />
      ))}
      {status === "submitted" && (
        <div className="flex justify-start">
          <div className="bg-muted text-muted-foreground rounded-lg px-4 py-2 text-sm">
            <span className="inline-flex gap-1">
              <span className="animate-pulse">·</span>
              <span className="animate-pulse [animation-delay:150ms]">·</span>
              <span className="animate-pulse [animation-delay:300ms]">·</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  onApproval,
}: {
  message: AntonUIMessage;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg text-sm break-words space-y-2",
          isUser
            ? "bg-primary text-primary-foreground px-4 py-2"
            : "bg-muted text-foreground px-4 py-2",
        )}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <div key={i} className="whitespace-pre-wrap">
                {part.text}
              </div>
            );
          }
          if (isToolUIPart(part)) {
            const name = getToolName(part);
            return (
              <ToolCard
                key={i}
                name={String(name)}
                state={part.state}
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
    </div>
  );
}
