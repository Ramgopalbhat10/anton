"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ToolDetailSection({
  label,
  children,
  tone,
  scrollable = false,
  maxHeight = "max-h-40",
}: {
  label: string;
  children: ReactNode;
  tone?: "error";
  scrollable?: boolean;
  maxHeight?: string;
}) {
  const body = scrollable ? (
    <div className={cn("overflow-y-auto", maxHeight)}>
      <div className="px-2.5 py-2">{children}</div>
    </div>
  ) : (
    <div className="px-2.5 py-2">{children}</div>
  );

  return (
    <div className="space-y-[5px]">
      <div
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/65",
          tone === "error" && "text-destructive/80",
        )}
      >
        {label}
      </div>
      <div className="overflow-hidden rounded-md border border-layout-border bg-background">
        {body}
      </div>
    </div>
  );
}

export function ToolDetailFooter({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  );
}

export function ToolDetailFailedBadge() {
  return (
    <span className="rounded bg-destructive/8 px-[7px] py-px text-[10px] font-bold uppercase tracking-wide text-destructive">
      FAILED
    </span>
  );
}

export function ToolDetailCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      className="shrink-0 text-muted-foreground/65 hover:text-foreground"
      aria-label="Copy"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? (
        <CheckCircle2 className="size-2.5 text-success" />
      ) : (
        <Copy className="size-2.5" />
      )}
    </Button>
  );
}

export function ToolDetailCardHead({
  toolName,
  step,
  failed,
  copyText,
}: {
  toolName: string;
  step?: number | string;
  failed?: boolean;
  copyText?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b px-3 py-2",
        failed ? "border-destructive/19" : "border-layout-border",
      )}
    >
      <span className="font-mono text-xs font-semibold text-foreground">
        {toolName}
      </span>
      {failed ? <ToolDetailFailedBadge /> : null}
      {step !== undefined ? (
        <span className="font-sans text-[11px] text-muted-foreground/65">
          step {step}
        </span>
      ) : null}
      <span className="min-w-0 flex-1" />
      {copyText ? <ToolDetailCopyButton text={copyText} /> : null}
    </div>
  );
}

export function ToolDetailCard({
  toolName,
  step,
  failed,
  denied,
  copyText,
  footer,
  children,
  className,
}: {
  toolName: string;
  step?: number | string;
  failed?: boolean;
  denied?: boolean;
  copyText?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        failed && "border-destructive/25",
        denied && "border-border/60",
        !failed && !denied && "border-border",
        className,
      )}
    >
      <ToolDetailCardHead
        toolName={toolName}
        step={step}
        failed={failed}
        copyText={copyText}
      />
      <div className="flex flex-col gap-2.5 p-3">
        {children}
        {footer}
      </div>
    </div>
  );
}
