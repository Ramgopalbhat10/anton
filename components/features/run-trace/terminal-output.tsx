"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { BashCommandBar } from "./bash-command-bar";
import {
  parseBashOutput,
  renderAnsiToHtml,
  terminalStatus,
  type BashOutput,
} from "./terminal-utils";

interface TerminalOutputProps {
  command?: string;
  output: BashOutput | string | unknown;
  className?: string;
}

export function TerminalOutput({ command, output, className }: TerminalOutputProps) {
  const parsed = useMemo(() => parseBashOutput(output), [output]);

  const stdoutHtml = useMemo(
    () => (parsed.stdout ? renderAnsiToHtml(parsed.stdout) : null),
    [parsed.stdout],
  );
  const stderrHtml = useMemo(
    () => (parsed.stderr ? renderAnsiToHtml(parsed.stderr) : null),
    [parsed.stderr],
  );

  const hasOutput = stdoutHtml || stderrHtml;
  const status = terminalStatus(parsed);

  return (
    <div
      className={cn(
        "rounded-md bg-panel ring-1 ring-border font-mono text-ui-mono leading-relaxed overflow-hidden",
        className,
      )}
    >
      {command ? <BashCommandBar command={command} /> : null}
      {hasOutput ? (
        <div className="max-h-64 overflow-y-auto px-3 py-2 space-y-1">
          {stdoutHtml && (
            <pre
              className="whitespace-pre-wrap wrap-break-word text-foreground/80"
              dangerouslySetInnerHTML={{ __html: stdoutHtml }}
            />
          )}
          {stderrHtml && (
            <pre
              className="whitespace-pre-wrap wrap-break-word text-amber-300/90"
              dangerouslySetInnerHTML={{ __html: stderrHtml }}
            />
          )}
        </div>
      ) : (
        <div className="px-3 py-2 text-muted-foreground/50 italic">
          (no output)
        </div>
      )}
      {(status || parsed.commandPolicyMode || parsed.boundary) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/8 px-2 py-1">
          {status ? (
            <span
              className={cn(
                "text-[10px] font-medium",
                status.tone === "error"
                  ? "text-red-400"
                  : "text-muted-foreground/60",
              )}
            >
              {status.label}
            </span>
          ) : null}
          {parsed.commandPolicyMode ? (
            <span className="text-[10px] text-muted-foreground/60">
              Policy: {parsed.commandPolicyMode}
            </span>
          ) : null}
          {parsed.boundary ? (
            <span className="text-[10px] text-muted-foreground/60">
              Boundary: {parsed.boundary.label}
            </span>
          ) : null}
          {parsed.boundary ? (
            <span className="text-[10px] text-muted-foreground/60">
              Confinement: Unconfined
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
