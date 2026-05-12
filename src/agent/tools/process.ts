import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildBashEnvironment } from "../command-policy";
import { redactText } from "@/src/lib/redaction";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 64 * 1024;

export type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function runWorkspaceProcess(
  file: string,
  args: readonly string[],
  cwd: string,
): Promise<ProcessResult> {
  try {
    const result = await execFileAsync(file, [...args], {
      cwd,
      env: buildBashEnvironment() as NodeJS.ProcessEnv,
      windowsHide: true,
      maxBuffer: MAX_OUTPUT_BYTES * 4,
    });
    return {
      exitCode: 0,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
    };
  } catch (err) {
    return {
      exitCode: exitCode(err),
      stdout: truncate(outputText(err, "stdout")),
      stderr: truncate(outputText(err, "stderr") || errorMessage(err)),
    };
  }
}

function truncate(output: string): string {
  const redacted = redactText(output);
  const buf = Buffer.from(redacted, "utf8");
  if (buf.byteLength <= MAX_OUTPUT_BYTES) return redacted;
  const head = buf.subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
  return `${head}\n...[truncated ${buf.byteLength - MAX_OUTPUT_BYTES} bytes]`;
}

function outputText(err: unknown, key: "stdout" | "stderr"): string {
  if (typeof err !== "object" || err === null || !(key in err)) return "";
  const value = (err as Record<typeof key, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function exitCode(err: unknown): number {
  if (typeof err !== "object" || err === null || !("code" in err)) return 1;
  const code = (err as { code: unknown }).code;
  return typeof code === "number" ? code : 1;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
