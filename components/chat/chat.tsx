"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { DEFAULT_MODEL, type ModelId } from "@/src/lib/providers";
import { MessageList } from "./message-list";
import { Composer } from "./composer";
import { ModelPicker } from "./model-picker";

export function Chat() {
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL as ModelId);

  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ model }),
    }),
  });

  const streaming = status === "streaming" || status === "submitted";

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold tracking-tight">Anton</h1>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Phase 1
          </span>
        </div>
        <ModelPicker value={model} onChange={setModel} disabled={streaming} />
      </header>

      <MessageList messages={messages} status={status} />

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
