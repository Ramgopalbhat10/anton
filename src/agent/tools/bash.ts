import { z } from "zod";
import { execa } from "execa";
import { tool } from "ai";
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
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export function createBashTool(workspaceRoot?: string) {
  return tool({
    description:
      "Run a shell command inside the workspace directory. The command is classified by risk category before execution, runs with a timeout, and has its output truncated. `sudo` is forbidden. Requires user approval.",
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

      const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const classification = policy.classification;

      return executeWithStreaming(command, root, timeout, toolCallId, classification);
    },
  });
}

export const bashTool = createBashTool();

function truncate(output: string): string {
  const redacted = redactText(output);
  const buf = Buffer.from(redacted, "utf8");
  if (buf.byteLength <= MAX_OUTPUT_BYTES) return redacted;
  const head = buf.subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
  return `${head}\n…[truncated ${buf.byteLength - MAX_OUTPUT_BYTES} bytes]`;
}

async function executeWithStreaming(
  command: string,
  root: string,
  timeout: number,
  streamId: string,
  classification: ReturnType<typeof classifyBashCommand>,
): Promise<BashToolOkOutput | BashToolErrorOutput> {
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

    return {
      ok: true as const,
      classification,
      riskCategories: classification.categories as string[],
      exitCode,
      timedOut,
      killed,
      failedReason,
      stdout: truncate(stdoutChunks.join("")),
      stderr: truncate(stderrChunks.join("")),
      streamId,
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

type BashToolOkOutput = {
  ok: true;
  classification: ReturnType<typeof classifyBashCommand>;
  riskCategories: string[];
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
  failedReason?: BashFailedReason;
  stdout: string;
  stderr: string;
  streamId: string;
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

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
