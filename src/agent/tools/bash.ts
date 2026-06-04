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
import { modelVisibleToolOutput } from "./model-output";
import {
  commandPolicyModeForPermission,
  type CommandPolicyMode,
  type PermissionMode,
} from "../permissions";

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 300_000;
const SEARCH_COMMAND_TIMEOUT_MS = 240_000;

export function createBashTool(
  workspaceRoot?: string,
  permissionMode: PermissionMode = "auto-review",
) {
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
      const commandPolicyMode = commandPolicyModeForPermission(permissionMode);
      if (commandPolicyMode === "enforced" && !policy.allowed) {
        return {
          ok: false as const,
          commandPolicyMode,
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

      return executeWithStreaming(
        command,
        root,
        timeout,
        toolCallId,
        classification,
        commandPolicyMode,
      );
    },
  });
}

export const bashTool = createBashTool();

function compactBashModelOutput(output: unknown): JSONValue {
  if (!isRecord(output)) {
    return modelVisibleToolOutput(output, {
      successCode: "BASH_OK",
      failureCode: "BASH_OUTPUT_MALFORMED",
      successSummary: "Command completed.",
      failureSummary: "Bash returned malformed output.",
      failureRecommendedNext: "Retry with a simpler command or report the tool failure.",
    }) as JSONValue;
  }
  const exitCode = numberOrNull(output.exitCode);
  const failedReason =
    typeof output.failedReason === "string" ? output.failedReason : undefined;
  const stderr = stringValue(output.stderr);
  const ok = output.ok === true && exitCode === 0 && failedReason === undefined;
  const failureCode = bashFailureCode(output, exitCode, failedReason);
  return modelVisibleToolOutput({
    ok,
    exitCode,
    timedOut: booleanValue(output.timedOut),
    killed: booleanValue(output.killed),
    commandPolicyMode: commandPolicyModeValue(output.commandPolicyMode),
    failedReason: failedReason ?? null,
    stdoutTail: tail(stringValue(output.stdout), 4_000),
    stderrTail: tail(stderr, 4_000),
    error:
      typeof output.error === "string"
        ? output.error
        : exitCode !== null && exitCode !== 0
          ? `Command exited with code ${exitCode}.`
          : failedReason ?? null,
  }, {
    successCode: "BASH_OK",
    failureCode,
    successSummary: "Command completed successfully.",
    failureSummary:
      typeof output.error === "string"
        ? output.error
        : exitCode !== null && exitCode !== 0
          ? `Command exited with code ${exitCode}.`
          : failedReason ?? "Command failed.",
    successRecommendedNext: "Continue with the command output.",
    failureRecommendedNext: recommendedNextForBashFailure(failureCode, ok),
  }) as JSONValue;
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
  commandPolicyMode: CommandPolicyMode,
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
      commandPolicyMode,
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
      commandPolicyMode,
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
  commandPolicyMode: CommandPolicyMode;
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
  commandPolicyMode: CommandPolicyMode;
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

function commandPolicyModeValue(value: unknown): CommandPolicyMode {
  return value === "advisory" ? "advisory" : "enforced";
}

function tail(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(value.length - maxLength);
}

function bashFailureCode(
  output: Record<string, unknown>,
  exitCode: number | null,
  failedReason: string | undefined,
): string {
  if (output.ok === true && exitCode === 0 && failedReason === undefined) {
    return "BASH_OK";
  }
  if (
    output.ok === false &&
    typeof output.error === "string" &&
    exitCode === null &&
    failedReason === undefined
  ) {
    return "BASH_POLICY_REJECTED";
  }
  if (failedReason === "timeout") return "BASH_TIMEOUT";
  if (failedReason === "max_buffer") return "BASH_OUTPUT_TRUNCATED";
  if (exitCode !== null && exitCode !== 0) return "BASH_NONZERO_EXIT";
  return "BASH_FAILED";
}

function recommendedNextForBashFailure(
  code: string,
  ok: boolean,
): string | undefined {
  if (ok) return undefined;
  if (code === "BASH_POLICY_REJECTED") {
    return "Revise the command to satisfy the workspace command policy.";
  }
  if (code === "BASH_TIMEOUT") {
    return "Run a narrower command or request a longer timeout within the tool cap.";
  }
  if (code === "BASH_NONZERO_EXIT") {
    return "Inspect stderr/stdout, fix the underlying issue, then retry if needed.";
  }
  if (code === "BASH_OUTPUT_TRUNCATED") {
    return "Rerun with narrower output or use a purpose-built read/search tool.";
  }
  return "Retry with a simpler command or report the failure.";
}
