"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useBashStream } from "./use-bash-stream";
import {
  renderAnsiToHtml,
  terminalStatus,
  type BashOutput,
} from "./terminal-utils";

interface LiveTerminalOutputProps {
  command?: string;
  streamId: string;
  streamToken?: string;
  initialOutput?: BashOutput;
  className?: string;
}

export function LiveTerminalOutput({
  command,
  streamId,
  streamToken,
  initialOutput,
  className,
}: LiveTerminalOutputProps) {
  const streamState = useBashStream(streamId, streamToken, true);

  const stdout = streamState.stdout || initialOutput?.stdout || "";
  const stderr = streamState.stderr || initialOutput?.stderr || "";
  const exitCode = streamState.exitCode ?? initialOutput?.exitCode;
  const timedOut = streamState.timedOut ?? initialOutput?.timedOut;
  const killed = streamState.killed ?? initialOutput?.killed;
  const failedReason = streamState.failedReason ?? initialOutput?.failedReason;
  const isRunning = Boolean(streamToken) && !streamState.finished;
  const status = terminalStatus({
    exitCode,
    timedOut,
    killed,
    failedReason,
  });

  const stdoutHtml = useMemo(
    () => (stdout ? renderAnsiToHtml(stdout) : null),
    [stdout],
  );
  const stderrHtml = useMemo(
    () => (stderr ? renderAnsiToHtml(stderr) : null),
    [stderr],
  );

  const hasOutput = stdoutHtml || stderrHtml;

  return (
    <div
      className={cn(
        "rounded-md bg-[#0d0d0d] ring-1 ring-white/8 font-mono text-[11px] leading-relaxed overflow-hidden",
        className,
      )}
    >
      {command && (
        <div className="flex items-start gap-1.5 border-b border-white/8 px-2 py-1">
          <span className="shrink-0 select-none text-emerald-400">$</span>
          <span className="text-foreground/90 whitespace-pre-wrap break-all flex-1">{command}</span>
          {isRunning && (
            <Loader2 className="size-3.5 animate-spin text-sky-400 shrink-0 mt-0.5" />
          )}
        </div>
      )}
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
      ) : isRunning ? (
        <div className="px-3 py-2 text-muted-foreground/50 italic flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" />
          Running...
        </div>
      ) : (
        <div className="px-3 py-2 text-muted-foreground/50 italic">
          (no output)
        </div>
      )}
      {status ? (
        <div className="border-t border-white/8 px-2 py-1">
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
        </div>
      ) : isRunning ? (
        <div className="border-t border-white/8 px-2 py-1">
          <span className="text-[10px] font-medium text-sky-400 animate-pulse">
            Running...
          </span>
        </div>
      ) : null}
    </div>
  );
}
