"use client";

import { BashTerminal } from "./bash-terminal";
import { useBashStream } from "./use-bash-stream";
import { type BashOutput } from "./terminal-utils";

interface LiveTerminalOutputProps {
  command?: string;
  streamId: string;
  streamToken?: string;
  initialOutput?: BashOutput;
  step?: number | string;
  variant?: "standalone" | "sections";
  showCopyButton?: boolean;
  includeFooter?: boolean;
  className?: string;
}

export function LiveTerminalOutput({
  command,
  streamId,
  streamToken,
  initialOutput,
  step,
  variant = "standalone",
  showCopyButton = true,
  includeFooter = true,
  className,
}: LiveTerminalOutputProps) {
  const streamState = useBashStream(streamId, streamToken, true);

  const stdout = streamState.stdout || initialOutput?.stdout || "";
  const stderr = streamState.stderr || initialOutput?.stderr || "";
  const exitCode = streamState.exitCode ?? initialOutput?.exitCode;
  const timedOut = streamState.timedOut ?? initialOutput?.timedOut;
  const killed = streamState.killed ?? initialOutput?.killed;
  const failedReason = streamState.failedReason ?? initialOutput?.failedReason;
  const commandPolicyMode = initialOutput?.commandPolicyMode;
  const boundary = initialOutput?.boundary;
  const isRunning = Boolean(streamToken) && !streamState.finished;

  return (
    <BashTerminal
      command={command}
      stdout={stdout}
      stderr={stderr}
      exitCode={exitCode}
      timedOut={timedOut}
      killed={killed}
      failedReason={failedReason}
      commandPolicyMode={commandPolicyMode}
      boundary={boundary}
      step={step}
      variant={variant}
      showCopyButton={showCopyButton}
      includeFooter={includeFooter}
      isRunning={isRunning}
      className={className}
    />
  );
}
