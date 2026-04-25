"use client";

import { useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";

import { DEFAULT_MODEL_ID, type ModelId } from "@/src/lib/models";
import type { AntonUIMessage } from "@/src/agent/loop";
import { MessageList } from "./message-list";
import { Composer } from "./composer";
import { ModelPicker } from "./model-picker";
import { useSessionStore } from "./session-store";

interface ChatProps {
  sessionId?: string;
  initialMessages?: AntonUIMessage[];
  initialModel?: ModelId;
  initialTitle?: string;
  initialTokensTotal?: number;
}

export function Chat({
  sessionId: sessionIdProp,
  initialMessages,
  initialModel,
  initialTitle,
  initialTokensTotal = 0,
}: ChatProps) {
  const { sessions, refresh } = useSessionStore();
  const persistedRef = useRef(sessionIdProp !== undefined);

  const [sessionId] = useState<string>(() => sessionIdProp ?? generateId());
  const [model, setModel] = useState<ModelId>(
    (initialModel ?? DEFAULT_MODEL_ID) as ModelId,
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AntonUIMessage>({
        api: "/api/chat",
        body: () => ({ sessionId, model }),
      }),
    [sessionId, model],
  );

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    addToolApprovalResponse,
  } = useChat<AntonUIMessage>({
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => {
      if (!persistedRef.current) {
        persistedRef.current = true;
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", `/s/${sessionId}`);
        }
      }
      void refresh();
    },
  });

  const streaming = status === "streaming" || status === "submitted";
  const headerTitle = initialTitle ?? (sessionIdProp ? "Session" : "New chat");
  const tokensTotal =
    sessions.find((s) => s.id === sessionId)?.tokensTotal ?? initialTokensTotal;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
        <h1 className="text-sm font-semibold tracking-tight truncate min-w-0">
          {headerTitle}
        </h1>
        <div className="flex items-center gap-3 shrink-0">
          <TokenCounter tokens={tokensTotal} pending={streaming} />
          <ModelPicker value={model} onChange={setModel} disabled={streaming} />
        </div>
      </header>

      <MessageList
        messages={messages}
        status={status}
        onApproval={addToolApprovalResponse}
      />

      {error && (
        <div className="px-4 py-2 text-xs text-destructive border-t border-border">
          Error: {error.message}
        </div>
      )}

      <Composer
        onSend={(text) => sendMessage({ text })}
        onStop={stop}
        disabled={streaming}
        streaming={streaming}
      />
    </div>
  );
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function TokenCounter({
  tokens,
  pending,
}: {
  tokens: number;
  pending: boolean;
}) {
  if (tokens <= 0 && !pending) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-[11px] font-mono text-muted-foreground"
      title="Total tokens used in this session"
    >
      <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
      {formatTokens(tokens)}
      <span className="text-muted-foreground/70">tok</span>
    </span>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
