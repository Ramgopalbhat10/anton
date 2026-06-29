import { execa, type ResultPromise } from "execa";

import { buildBashEnvironment } from "@/src/agent/command-policy";
import { redactText } from "@/src/lib/redaction";
import { loadProjectEnvironmentForProcess } from "@/src/workspace/project-env";

const DEFAULT_OUTPUT_CAP_BYTES = 64 * 1024;

export type WorkspaceExecutionBoundary = {
  kind: "workspace-cwd";
  confinement: "unconfined";
  label: "Workspace cwd only";
};

export type WorkspaceProcessFailedReason =
  | "timeout"
  | "killed"
  | "max_buffer"
  | "error";

export type WorkspaceProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killed: boolean;
  failedToStart: boolean;
  failedReason?: WorkspaceProcessFailedReason;
  boundary: WorkspaceExecutionBoundary;
};

export type WorkspaceProcessOptions = {
  timeoutMs?: number;
  outputCapBytes?: number;
  maxBufferBytes?: number;
  cleanup?: boolean;
  detached?: boolean;
  forceKillAfterDelay?: false | number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export type StartedWorkspaceProcess = {
  subprocess: ResultPromise;
  stdoutChunks: string[];
  stderrChunks: string[];
  result: Promise<WorkspaceProcessResult>;
  boundary: WorkspaceExecutionBoundary;
};

const WORKSPACE_EXECUTION_BOUNDARY: WorkspaceExecutionBoundary = {
  kind: "workspace-cwd",
  confinement: "unconfined",
  label: "Workspace cwd only",
};

export function getWorkspaceExecutionBoundary(): WorkspaceExecutionBoundary {
  return WORKSPACE_EXECUTION_BOUNDARY;
}

export async function runWorkspaceProcess(
  file: string,
  args: readonly string[],
  cwd: string,
  options: WorkspaceProcessOptions = {},
): Promise<WorkspaceProcessResult> {
  const started = startWorkspaceProcess(file, args, cwd, options);
  return await started.result;
}

export function startWorkspaceProcess(
  file: string,
  args: readonly string[],
  cwd: string,
  options: WorkspaceProcessOptions = {},
): StartedWorkspaceProcess {
  const outputCapBytes = options.outputCapBytes ?? DEFAULT_OUTPUT_CAP_BYTES;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const projectEnv = loadProjectEnvironmentForProcess(cwd);
  const env = buildWorkspaceProcessEnvironment(cwd, projectEnv);
  const subprocess = execa(file, [...args], {
    cwd,
    env,
    extendEnv: false,
    timeout: options.timeoutMs,
    reject: false,
    stripFinalNewline: false,
    cleanup: options.cleanup ?? true,
    windowsHide: true,
    detached: options.detached,
    maxBuffer: options.maxBufferBytes ?? outputCapBytes * 4,
    ...(options.forceKillAfterDelay !== undefined
      ? { forceKillAfterDelay: options.forceKillAfterDelay }
      : {}),
  });

  subprocess.stdout?.on("data", (chunk: Buffer) => {
    const text = redactProcessOutput(chunk.toString("utf8"), projectEnv);
    stdoutChunks.push(text);
    options.onStdout?.(text);
  });

  subprocess.stderr?.on("data", (chunk: Buffer) => {
    const text = redactProcessOutput(chunk.toString("utf8"), projectEnv);
    stderrChunks.push(text);
    options.onStderr?.(text);
  });

  const result = subprocess
    .then((execaResult) =>
      resultFromCompletedProcess({
        execaResult,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        outputCapBytes,
      }),
    )
    .catch((err: unknown) =>
      resultFromFailedProcess({
        err,
        stdout: stdoutChunks.join("") || outputText(err, "stdout"),
        stderr: stderrChunks.join("") || outputText(err, "stderr") || errorMessage(err),
        outputCapBytes,
      }),
    );

  return {
    subprocess,
    stdoutChunks,
    stderrChunks,
    result,
    boundary: getWorkspaceExecutionBoundary(),
  };
}

export function buildWorkspaceProcessEnvironment(
  cwd: string,
  projectEnv: Record<string, string> = loadProjectEnvironmentForProcess(cwd),
): Record<string, string> {
  return {
    ...buildBashEnvironment(),
    ...projectEnv,
  };
}

export function truncateWorkspaceProcessOutput(
  output: string,
  outputCapBytes = DEFAULT_OUTPUT_CAP_BYTES,
): string {
  const redacted = redactText(output);
  const buf = Buffer.from(redacted, "utf8");
  if (buf.byteLength <= outputCapBytes) return redacted;
  const head = buf.subarray(0, outputCapBytes).toString("utf8");
  return `${head}\n...[truncated ${buf.byteLength - outputCapBytes} bytes]`;
}

function resultFromCompletedProcess({
  execaResult,
  stdout,
  stderr,
  outputCapBytes,
}: {
  execaResult: unknown;
  stdout: string;
  stderr: string;
  outputCapBytes: number;
}): WorkspaceProcessResult {
  const result = asProcessRecord(execaResult);
  const timedOut = result.timedOut === true;
  const killed = result.isCanceled === true && !timedOut;
  const isMaxBuffer = result.isMaxBuffer === true;
  const failedReason = failedReasonForResult({ timedOut, killed, isMaxBuffer });
  return {
    exitCode: typeof result.exitCode === "number" ? result.exitCode : null,
    stdout: truncateWorkspaceProcessOutput(stdout, outputCapBytes),
    stderr: truncateWorkspaceProcessOutput(stderr, outputCapBytes),
    timedOut,
    killed,
    failedToStart: false,
    ...(failedReason ? { failedReason } : {}),
    boundary: getWorkspaceExecutionBoundary(),
  };
}

function resultFromFailedProcess({
  err,
  stdout,
  stderr,
  outputCapBytes,
}: {
  err: unknown;
  stdout: string;
  stderr: string;
  outputCapBytes: number;
}): WorkspaceProcessResult {
  const timedOut = timedOutError(err);
  const failedToStart = failedToStartError(err);
  const killed = killedError(err) && !timedOut;
  const isMaxBuffer = maxBufferError(err);
  return {
    exitCode: exitCode(err),
    stdout: truncateWorkspaceProcessOutput(stdout, outputCapBytes),
    stderr: truncateWorkspaceProcessOutput(stderr, outputCapBytes),
    timedOut,
    killed,
    failedToStart,
    failedReason: timedOut
      ? "timeout"
      : killed
        ? "killed"
        : isMaxBuffer
          ? "max_buffer"
          : "error",
    boundary: getWorkspaceExecutionBoundary(),
  };
}

function failedReasonForResult(input: {
  timedOut: boolean;
  killed: boolean;
  isMaxBuffer: boolean;
}): WorkspaceProcessFailedReason | undefined {
  if (input.timedOut) return "timeout";
  if (input.killed) return "killed";
  if (input.isMaxBuffer) return "max_buffer";
  return undefined;
}

function outputText(err: unknown, key: "stdout" | "stderr"): string {
  if (typeof err !== "object" || err === null || !(key in err)) return "";
  const value = (err as Record<typeof key, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function exitCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null || !("exitCode" in err)) return null;
  const code = (err as { exitCode: unknown }).exitCode;
  return typeof code === "number" ? code : null;
}

function timedOutError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { timedOut?: unknown }).timedOut === true;
}

function killedError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { isCanceled?: unknown; killed?: unknown }).isCanceled === true;
}

function maxBufferError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { isMaxBuffer?: unknown }).isMaxBuffer === true;
}

function failedToStartError(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  const code = (err as { code: unknown }).code;
  return (
    code === "ENOENT" ||
    code === "EACCES" ||
    code === "EPERM" ||
    code === "UNKNOWN"
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function asProcessRecord(value: unknown): {
  exitCode?: unknown;
  timedOut?: unknown;
  isCanceled?: unknown;
  isMaxBuffer?: unknown;
} {
  return typeof value === "object" && value !== null ? value : {};
}

function redactProcessOutput(
  value: string,
  env: Record<string, string>,
): string {
  let redacted = redactText(value);
  for (const secret of Object.values(env)) {
    if (secret.length < 4) continue;
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}
