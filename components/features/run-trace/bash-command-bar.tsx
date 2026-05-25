"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function BashCommandBar({
  command,
  trailing,
  className,
}: {
  command: string;
  trailing?: ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      className={cn(
        "flex items-start gap-1.5 border-b border-white/8 px-2 py-1",
        className,
      )}
    >
      <span className="shrink-0 select-none pt-px text-emerald-400">$</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-foreground/90">
        {command}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        {trailing}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="text-muted-foreground/70 hover:text-foreground"
          aria-label="Copy command"
          title="Copy command"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? (
            <CheckCircle2 className="size-2.5 text-emerald-400" />
          ) : (
            <Copy className="size-2.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
