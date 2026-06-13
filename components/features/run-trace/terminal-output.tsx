"use client";

import { useMemo } from "react";

import { BashTerminal } from "./bash-terminal";
import { parseBashOutput, type BashOutput } from "./terminal-utils";

interface TerminalOutputProps {
  command?: string;
  output: BashOutput | string | unknown;
  step?: number | string;
  variant?: "standalone" | "sections";
  showCopyButton?: boolean;
  includeFooter?: boolean;
  className?: string;
}

export function TerminalOutput({
  command,
  output,
  step,
  variant = "standalone",
  showCopyButton = true,
  includeFooter = true,
  className,
}: TerminalOutputProps) {
  const parsed = useMemo(() => parseBashOutput(output), [output]);

  return (
    <BashTerminal
      command={command}
      stdout={parsed.stdout}
      stderr={parsed.stderr}
      exitCode={parsed.exitCode}
      timedOut={parsed.timedOut}
      killed={parsed.killed}
      failedReason={parsed.failedReason}
      commandPolicyMode={parsed.commandPolicyMode}
      boundary={parsed.boundary}
      step={step}
      variant={variant}
      showCopyButton={showCopyButton}
      includeFooter={includeFooter}
      className={className}
    />
  );
}
