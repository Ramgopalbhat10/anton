"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  ToolDetailCardHead,
  ToolDetailFooter,
  ToolDetailSection,
} from "./tool-detail-card";
import {
  renderAnsiToHtml,
  terminalStatus,
  type BashOutput,
} from "./terminal-utils";

function bashCopyText(
  command: string | undefined,
  stdout: string | undefined,
  stderr: string | undefined,
): string | undefined {
  const parts: string[] = [];
  if (command) parts.push(`$ ${command}`);
  if (stdout) parts.push(stdout);
  if (stderr) parts.push(stderr);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function BashTerminalFooter({
  exitCode,
  timedOut,
  killed,
  failedReason,
  commandPolicyMode,
  boundary,
  isRunning = false,
}: Partial<BashOutput> & { isRunning?: boolean }) {
  const status = terminalStatus({
    exitCode,
    timedOut,
    killed,
    failedReason,
  });

  if (!status && !isRunning && !commandPolicyMode && !boundary) {
    return null;
  }

  return (
    <ToolDetailFooter>
      {status ? (
        <span
          className={cn(
            "font-mono text-[11px] font-semibold",
            status.tone === "error" ? "text-destructive" : "text-success",
          )}
        >
          {status.label}
        </span>
      ) : isRunning ? (
        <span className="animate-pulse font-mono text-[11px] font-semibold text-info">
          Running...
        </span>
      ) : null}
      {commandPolicyMode ? (
        <span className="text-[11px] text-muted-foreground/65">
          Policy: {commandPolicyMode}
        </span>
      ) : null}
      {boundary ? (
        <span className="text-[11px] text-muted-foreground/65">
          Boundary: {boundary.label}
        </span>
      ) : null}
      {boundary ? (
        <span className="text-[11px] text-muted-foreground/65">
          Confinement: Unconfined
        </span>
      ) : null}
    </ToolDetailFooter>
  );
}

export interface BashTerminalProps {
  command?: string;
  stdout?: string;
  stderr?: string;
  step?: number | string;
  variant?: "standalone" | "sections";
  showCopyButton?: boolean;
  includeFooter?: boolean;
  isRunning?: boolean;
  className?: string;
}

export function BashTerminalSections({
  command,
  stdout,
  stderr,
  isRunning = false,
}: {
  command?: string;
  stdout?: string;
  stderr?: string;
  isRunning?: boolean;
}) {
  const stdoutHtml = useMemo(
    () => (stdout ? renderAnsiToHtml(stdout) : null),
    [stdout],
  );
  const stderrHtml = useMemo(
    () => (stderr ? renderAnsiToHtml(stderr) : null),
    [stderr],
  );
  const hasOutput = Boolean(stdoutHtml || stderrHtml);

  return (
    <>
      {command ? (
        <ToolDetailSection label="COMMAND">
          <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.65] text-muted-foreground">
            $ {command}
          </pre>
        </ToolDetailSection>
      ) : null}

      <ToolDetailSection label="OUTPUT" scrollable maxHeight="max-h-64">
        {hasOutput ? (
          <>
            {stdoutHtml ? (
              <pre
                className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.65] text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: stdoutHtml }}
              />
            ) : null}
            {stderrHtml ? (
              <pre
                className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.65] text-destructive/90"
                dangerouslySetInnerHTML={{ __html: stderrHtml }}
              />
            ) : null}
          </>
        ) : isRunning ? (
          <div className="flex items-center gap-2 font-mono text-[10.5px] italic text-muted-foreground/50">
            <Loader2 className="size-3 animate-spin" />
            Running...
          </div>
        ) : (
          <pre className="font-mono text-[10.5px] italic text-muted-foreground/50">
            (no output)
          </pre>
        )}
      </ToolDetailSection>
    </>
  );
}

export function BashTerminal({
  command,
  stdout,
  stderr,
  step,
  variant = "standalone",
  showCopyButton = true,
  includeFooter = true,
  isRunning = false,
  className,
  exitCode,
  timedOut,
  killed,
  failedReason,
  commandPolicyMode,
  boundary,
}: BashTerminalProps & Partial<BashOutput>) {
  const status = terminalStatus({
    exitCode,
    timedOut,
    killed,
    failedReason,
  });
  const isFailed = status?.tone === "error";

  const sections = (
    <BashTerminalSections
      command={command}
      stdout={stdout}
      stderr={stderr}
      isRunning={isRunning}
    />
  );

  const footer =
    includeFooter ? (
      <BashTerminalFooter
        exitCode={exitCode}
        timedOut={timedOut}
        killed={killed}
        failedReason={failedReason}
        commandPolicyMode={commandPolicyMode}
        boundary={boundary}
        isRunning={isRunning}
      />
    ) : null;

  if (variant === "sections") {
    return (
      <div className={cn("font-mono", className)}>
        {sections}
        {footer}
      </div>
    );
  }

  const copyText = bashCopyText(command, stdout, stderr);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        isFailed ? "border-destructive/25" : "border-border",
        className,
      )}
    >
      <ToolDetailCardHead
        toolName="bash"
        step={step}
        failed={isFailed}
        copyText={showCopyButton ? copyText : undefined}
      />
      <div className="flex flex-col gap-2.5 p-3">
        {sections}
        {footer}
        {isRunning ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-info" />
        ) : null}
      </div>
    </div>
  );
}
