"use client";

import type { ChatAddToolApproveResponseFunction } from "ai";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

interface ToolCardProps {
  name: string;
  state: ToolState;
  input: unknown;
  output: unknown;
  errorText: string | undefined;
  approvalId: string | undefined;
  onApproval: ChatAddToolApproveResponseFunction;
}

export function ToolCard({
  name,
  state,
  input,
  output,
  errorText,
  approvalId,
  onApproval,
}: ToolCardProps) {
  const { label, tone } = stateBadge(state);

  return (
    <details
      className={cn(
        "rounded-md border text-xs not-prose",
        "border-border bg-background/60 text-foreground",
      )}
    >
      <summary className="flex items-center justify-between gap-2 cursor-pointer select-none px-3 py-2">
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] font-semibold truncate">
            {name}
          </span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
              tone,
            )}
          >
            {label}
          </span>
        </span>
      </summary>

      <div className="px-3 pb-3 pt-1 space-y-2">
        {input !== undefined && (
          <Section title="input">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words">
              {safeStringify(input)}
            </pre>
          </Section>
        )}

        {state === "approval-requested" && approvalId && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              onClick={() => onApproval({ id: approvalId, approved: true })}
            >
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => onApproval({ id: approvalId, approved: false })}
            >
              Deny
            </Button>
          </div>
        )}

        {state === "output-available" && output !== undefined && (
          <Section title="output">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words">
              {safeStringify(output)}
            </pre>
          </Section>
        )}

        {state === "output-error" && errorText && (
          <Section title="error" tone="error">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words">
              {errorText}
            </pre>
          </Section>
        )}

        {state === "output-denied" && (
          <Section title="denied" tone="error">
            <span>Execution was denied by the user.</span>
          </Section>
        )}
      </div>
    </details>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "error";
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div
        className={cn(
          "text-[10px] uppercase tracking-wider",
          tone === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {title}
      </div>
      <div className="font-mono text-[11px] leading-snug">{children}</div>
    </div>
  );
}

function stateBadge(state: ToolState): { label: string; tone: string } {
  switch (state) {
    case "input-streaming":
      return {
        label: "calling…",
        tone: "bg-muted text-muted-foreground",
      };
    case "input-available":
      return {
        label: "running…",
        tone: "bg-muted text-muted-foreground",
      };
    case "approval-requested":
      return {
        label: "needs approval",
        tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
      };
    case "approval-responded":
      return {
        label: "approved",
        tone: "bg-muted text-muted-foreground",
      };
    case "output-available":
      return {
        label: "done",
        tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      };
    case "output-error":
      return {
        label: "error",
        tone: "bg-destructive/15 text-destructive",
      };
    case "output-denied":
      return {
        label: "denied",
        tone: "bg-destructive/15 text-destructive",
      };
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
