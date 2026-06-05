"use client";

import AnsiToHtml from "ansi-to-html";

export type BashFailedReason = "timeout" | "killed" | "max_buffer" | "error";

export interface BashOutput {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  commandPolicyMode?: "enforced" | "advisory";
  timedOut?: boolean;
  killed?: boolean;
  failedReason?: BashFailedReason;
}

const converter = new AnsiToHtml({
  fg: "#d4d4d8",
  bg: "transparent",
  newline: true,
  escapeXML: true,
  stream: false,
});

export function parseBashOutput(output: unknown): BashOutput {
  if (typeof output === "string") return { stdout: output };
  if (typeof output !== "object" || output === null) return {};

  const record = output as Record<string, unknown>;
  return {
    stdout: typeof record.stdout === "string" ? record.stdout : undefined,
    stderr: typeof record.stderr === "string" ? record.stderr : undefined,
    exitCode:
      typeof record.exitCode === "number" || record.exitCode === null
        ? record.exitCode
        : undefined,
    commandPolicyMode:
      record.commandPolicyMode === "enforced" ||
      record.commandPolicyMode === "advisory"
        ? record.commandPolicyMode
        : undefined,
    timedOut:
      typeof record.timedOut === "boolean" ? record.timedOut : undefined,
    killed: typeof record.killed === "boolean" ? record.killed : undefined,
    failedReason: isFailedReason(record.failedReason)
      ? record.failedReason
      : undefined,
  };
}

export function renderAnsiToHtml(text: string): string {
  try {
    // Terminal output is untrusted; only this escaped HTML reaches dangerouslySetInnerHTML.
    return converter.toHtml(text);
  } catch {
    return escapeHtml(text);
  }
}

export function terminalStatus(
  output: BashOutput,
): { label: string; tone: "error" | "muted" } | undefined {
  if (output.timedOut || output.failedReason === "timeout") {
    return { label: "Timed out", tone: "error" };
  }
  if (output.killed || output.failedReason === "killed") {
    return { label: "Killed", tone: "error" };
  }
  if (output.failedReason === "max_buffer") {
    return { label: "Output limit exceeded", tone: "error" };
  }
  if (output.failedReason === "error") {
    return { label: "Command failed", tone: "error" };
  }
  if (typeof output.exitCode === "number") {
    return output.exitCode === 0
      ? { label: "Exited successfully", tone: "muted" }
      : { label: `Exit code ${output.exitCode}`, tone: "error" };
  }
  if (output.exitCode === null) {
    return { label: "No exit code", tone: "error" };
  }
  return undefined;
}

function isFailedReason(value: unknown): value is BashFailedReason {
  return (
    value === "timeout" ||
    value === "killed" ||
    value === "max_buffer" ||
    value === "error"
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
