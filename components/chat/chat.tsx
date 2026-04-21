"use client";

import { useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";

import { DEFAULT_MODEL, type ModelId } from "@/src/lib/providers";
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
}

export function Chat({
  sessionId: sessionIdProp,
  initialMessages,
  initialModel,
  initialTitle,
}: ChatProps) {
  const { refresh } = useSessionStore();
  const persistedRef = useRef(sessionIdProp !== undefined);

  const [sessionId] = useState<string>(() => sessionIdProp ?? generateId());
  const [model, setModel] = useState<ModelId>(
    (initialModel ?? DEFAULT_MODEL) as ModelId,
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

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="text-sm font-semibold tracking-tight truncate">
          {headerTitle}
        </h1>
        <ModelPicker value={model} onChange={setModel} disabled={streaming} />
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
