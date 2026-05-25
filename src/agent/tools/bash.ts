import { z } from "zod";
import { execa } from "execa";
import { tool, type JSONValue } from "ai";
import { ensureWorkspaceRoot, ensureWorkspaceRootAt } from "../sandbox";
import {
  buildBashEnvironment,
  classifyBashCommand,
  evaluateBashCommandPolicy,
} from "../command-policy";
import {
  bashProgress,
  type BashFailedReason,
} from "@/src/lib/bash-stream";
import { redactText } from "@/src/lib/redaction";

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 300_000;
const SEARCH_COMMAND_TIMEOUT_MS = 240_000;

export function createBashTool(workspaceRoot?: string) {
  return tool({
    description:
      "Run a shell command inside the workspace directory. The command is classified by risk category before execution, runs with a timeout, and has its output truncated. Prefer the `grep` tool for workspace text search instead of shell `grep`. `sudo` is forbidden. Requires user approval.",
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute via `bash -lc`."),
      timeoutMs: z
        .number()
        .int()
        .min(100)
        .max(MAX_TIMEOUT_MS)
        .optional()
        .describe(
          `Maximum time to wait before the command is killed. Defaults to ${DEFAULT_TIMEOUT_MS}ms, capped at ${MAX_TIMEOUT_MS}ms.`,
        ),
    }),
    toModelOutput: ({ output }) => ({
      type: "json",
      value: compactBashModelOutput(output),
    }),
    execute: async ({ command, timeoutMs }, { toolCallId }) => {
      const root = workspaceRoot
        ? ensureWorkspaceRootAt(workspaceRoot)
        : ensureWorkspaceRoot();
      const policy = evaluateBashCommandPolicy(command, { workspaceRoot: root });
      if (!policy.allowed) {
        return {
          ok: false as const,
          classification: policy.classification,
          riskCategories: policy.classification.categories as string[],
          error: policy.reason,
        };
      }

      const timeout =
        timeoutMs ??
        (looksLikeSearchCommand(command)
          ? SEARCH_COMMAND_TIMEOUT_MS
          : DEFAULT_TIMEOUT_MS);
      const classification = policy.classification;

      return executeWithStreaming(command, root, timeout, toolCallId, classification);
    },
  });
}

export const bashTool = createBashTool();

function compactBashModelOutput(output: unknown): JSONValue {
  if (!isRecord(output)) {
    return { ok: false, error: "unexpected bash output" };
  }
  const exitCode = numberOrNull(output.exitCode);
  const failedReason =
    typeof output.failedReason === "string" ? output.failedReason : undefined;
  const stderr = stringValue(output.stderr);
  return {
    ok: output.ok === true && exitCode === 0 && failedReason === undefined,
    exitCode,
    timedOut: booleanValue(output.timedOut),
    killed: booleanValue(output.killed),
    failedReason: failedReason ?? null,
    stdoutTail: tail(stringValue(output.stdout), 4_000),
    stderrTail: tail(stderr, 4_000),
    error:
      typeof output.error === "string"
        ? output.error
        : exitCode !== null && exitCode !== 0
          ? `Command exited with code ${exitCode}.`
          : failedReason ?? null,
  };
}

function truncate(output: string): string {
  const redacted = redactText(output);
  const buf = Buffer.from(redacted, "utf8");
  if (buf.byteLength <= MAX_OUTPUT_BYTES) return redacted;
  const head = buf.subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
  return `${head}\n...[truncated ${buf.byteLength - MAX_OUTPUT_BYTES} bytes]`;
}

async function executeWithStreaming(
  command: string,
  root: string,
  timeout: number,
  streamId: string,
  classification: ReturnType<typeof classifyBashCommand>,
): Promise<BashToolOutput | BashToolErrorOutput> {
  bashProgress.startStream(streamId);

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let sentExit = false;

  try {
    const subprocess = execa("bash", ["-lc", command], {
      cwd: root,
      env: buildBashEnvironment(),
      extendEnv: false,
      timeout,
      reject: false,
      stripFinalNewline: false,
      maxBuffer: MAX_OUTPUT_BYTES * 4,
    });

    subprocess.stdout?.on("data", (chunk: Buffer) => {
      const text = redactText(chunk.toString("utf8"));
      stdoutChunks.push(text);
      bashProgress.emitChunk(streamId, { type: "stdout", chunk: text });
    });

    subprocess.stderr?.on("data", (chunk: Buffer) => {
      const text = redactText(chunk.toString("utf8"));
      stderrChunks.push(text);
      bashProgress.emitChunk(streamId, { type: "stderr", chunk: text });
    });

    const result = await subprocess;
    const exitCode = result.exitCode ?? null;
    const timedOut = result.timedOut ?? false;
    const killed = result.isCanceled ?? false;
    const failedReason = failedReasonForResult({
      timedOut,
      killed,
      isMaxBuffer: result.isMaxBuffer ?? false,
    });

    bashProgress.emitChunk(streamId, {
      type: "exit",
      exitCode,
      timedOut,
      killed,
      failedReason,
    });
    sentExit = true;

    const commandFailed =
      failedReason !== undefined ||
      (exitCode !== null && exitCode !== 0);
    return {
      ok: !commandFailed,
      classification,
      riskCategories: classification.categories as string[],
      exitCode,
      timedOut,
      killed,
      failedReason,
      stdout: truncate(stdoutChunks.join("")),
      stderr: truncate(stderrChunks.join("")),
      streamId,
      ...(commandFailed
        ? {
            error:
              failedReason ??
              (exitCode !== null ? `Command exited with code ${exitCode}.` : "Command failed"),
          }
        : {}),
    };
  } catch (err) {
    const error = redactText(errorMessage(err));
    const stderr = truncate([...stderrChunks, error].filter(Boolean).join("\n"));
    bashProgress.emitChunk(streamId, { type: "stderr", chunk: `${error}\n` });
    bashProgress.emitChunk(streamId, {
      type: "exit",
      exitCode: null,
      timedOut: false,
      killed: false,
      failedReason: "error",
    });
    sentExit = true;

    return {
      ok: false as const,
      classification,
      riskCategories: classification.categories as string[],
      error,
      exitCode: null,
      timedOut: false,
      killed: false,
      failedReason: "error",
      stdout: truncate(stdoutChunks.join("")),
      stderr,
      streamId,
    };
  } finally {
    if (!sentExit) {
      bashProgress.emitChunk(streamId, {
        type: "exit",
        exitCode: null,
        timedOut: false,
        killed: false,
        failedReason: "error",
      });
    }
    bashProgress.endStream(streamId);
  }
}

type BashToolOutput = {
  ok: boolean;
  classification: ReturnType<typeof classifyBashCommand>;
  riskCategories: string[];
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
  failedReason?: BashFailedReason;
  stdout: string;
  stderr: string;
  streamId: string;
  error?: string;
};

type BashToolErrorOutput = {
  ok: false;
  classification: ReturnType<typeof classifyBashCommand>;
  riskCategories: string[];
  error: string;
  exitCode: null;
  timedOut: false;
  killed: false;
  failedReason: "error";
  stdout: string;
  stderr: string;
  streamId: string;
};

function failedReasonForResult({
  timedOut,
  killed,
  isMaxBuffer,
}: {
  timedOut: boolean;
  killed: boolean;
  isMaxBuffer: boolean;
}): BashFailedReason | undefined {
  if (timedOut) return "timeout";
  if (killed) return "killed";
  if (isMaxBuffer) return "max_buffer";
  return undefined;
}

function looksLikeSearchCommand(command: string): boolean {
  const trimmed = command.trim();
  return /^(grep|rg|find)\b/.test(trimmed);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function booleanValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function tail(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(value.length - maxLength);
}
