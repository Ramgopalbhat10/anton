"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ComposerProps {
  onSend: (text: string) => void;
  onStop: () => void;
  disabled: boolean;
  streaming: boolean;
}

const MIN_HEIGHT = 44; // ~2 rows
const MAX_HEIGHT = 240;

export function Composer({ onSend, onStop, disabled, streaming }: ComposerProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [input]);

  const submit = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="border-t border-border bg-background px-4 py-3"
    >
      <div className="flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message Anton... (Enter to send, Shift+Enter for newline)"
          rows={1}
          className="resize-none leading-6"
          style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
        />
        {streaming ? (
          <Button type="button" variant="destructive" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={disabled || !input.trim()}>
            Send
          </Button>
        )}
      </div>
    </form>
  );
}
