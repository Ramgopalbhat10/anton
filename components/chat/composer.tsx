"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUp,
  ChevronDown,
  GitBranch,
  Monitor,
  Plus,
  ShieldCheck,
  Square,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ModelId } from "@/src/lib/models";
import type { ProjectSummary } from "./workspace-dialog";
import { ModelPicker } from "./model-picker";

interface ComposerProps {
  onSend: (text: string) => void;
  onStop: () => void;
  disabled: boolean;
  streaming: boolean;
  model: ModelId;
  onModelChange: (model: ModelId) => void;
  tokens: number;
  project: ProjectSummary | null;
}

const MIN_HEIGHT = 24;
const MAX_HEIGHT = 44;

export function Composer({
  onSend,
  onStop,
  disabled,
  streaming,
  model,
  onModelChange,
  tokens,
  project,
}: ComposerProps) {
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
      className="w-full max-w-full shrink-0 overflow-hidden bg-background/95 px-3 pb-2 pt-1 sm:px-4"
    >
      <div className="mx-auto w-full max-w-[calc(100vw-1.5rem)] min-w-0 sm:max-w-3xl">
        <div className="rounded-lg bg-card p-2 ring-1 ring-border">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask for follow-up changes"
            rows={1}
            className="field-sizing-fixed min-h-0 min-w-0 resize-none rounded-none border-0 bg-transparent p-0 font-mono text-xs leading-5 shadow-none placeholder:font-mono focus-visible:ring-0 dark:bg-transparent md:text-xs"
            style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                aria-label="Add context"
              >
                <Plus />
              </Button>
              <button
                type="button"
                className="inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-primary hover:bg-primary/10"
              >
                <ShieldCheck className="size-3" />
                Full access
                <ChevronDown className="size-3" />
              </button>
            </div>

            <div className="flex min-w-0 items-center gap-1.5">
              <TokenCounter tokens={tokens} pending={streaming} />
              <ModelPicker
                value={model}
                onChange={onModelChange}
                disabled={streaming}
                triggerClassName="h-5 w-36 px-1.5 text-[11px]"
              />
              {streaming ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  onClick={onStop}
                  aria-label="Stop generation"
                >
                  <Square className="fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-xs"
                  disabled={disabled || !input.trim()}
                  aria-label="Send message"
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1.5 text-[11px] font-medium text-muted-foreground">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            <Monitor className="size-3.5" />
            Work locally
            <ChevronDown className="size-3" />
          </button>
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1.5 hover:text-foreground"
            title={project ? `${project.fullName} : ${project.defaultBranch}` : undefined}
          >
            <GitBranch className="size-3.5 shrink-0" />
            <span className="max-w-[20rem] truncate">
              {project
                ? `${project.fullName} : ${project.defaultBranch}`
                : "No codebase selected"}
            </span>
            <ChevronDown className="size-3 shrink-0" />
          </button>
        </div>
      </div>
    </form>
  );
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
      className="inline-flex h-5 items-center gap-1 rounded-md bg-secondary px-1.5 text-[11px] font-mono text-muted-foreground"
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
