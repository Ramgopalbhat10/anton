"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { BashCommandBar } from "./bash-command-bar";
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
        "rounded-md bg-panel ring-1 ring-border font-mono text-ui-mono leading-relaxed overflow-hidden",
        className,
      )}
    >
      {command ? (
        <BashCommandBar
          command={command}
          trailing={
            isRunning ? (
              <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-sky-400" />
            ) : undefined
          }
        />
      ) : null}
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
