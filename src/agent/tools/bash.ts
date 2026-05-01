import { z } from "zod";
import { execa } from "execa";
import { tool } from "ai";
import { ensureWorkspaceRoot, ensureWorkspaceRootAt } from "../sandbox";
import { isForbiddenBashCommand } from "../permissions";

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export function createBashTool(workspaceRoot?: string) {
  return tool({
  description:
    "Run a shell command inside the workspace directory. The command inherits a restricted environment, runs with a timeout, and has its output truncated. `sudo` is forbidden. Requires user approval.",
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
  needsApproval: true,
  execute: async ({ command, timeoutMs }) => {
    const forbidden = isForbiddenBashCommand(command);
    if (forbidden) {
      return {
        ok: false as const,
        error: `forbidden command pattern: ${forbidden}`,
      };
    }

    const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      const root = workspaceRoot
        ? ensureWorkspaceRootAt(workspaceRoot)
        : ensureWorkspaceRoot();
      const result = await execa("bash", ["-lc", command], {
        cwd: root,
        timeout,
        reject: false,
        all: true,
        stripFinalNewline: false,
        maxBuffer: MAX_OUTPUT_BYTES * 4,
      });

      return {
        ok: true as const,
        exitCode: result.exitCode ?? null,
        timedOut: result.timedOut ?? false,
        killed: result.isCanceled ?? false,
        stdout: truncate(result.stdout ?? ""),
        stderr: truncate(result.stderr ?? ""),
      };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
  });
}

export const bashTool = createBashTool();

function truncate(output: string): string {
  const buf = Buffer.from(output, "utf8");
  if (buf.byteLength <= MAX_OUTPUT_BYTES) return output;
  const head = buf.subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
  return `${head}\n…[truncated ${buf.byteLength - MAX_OUTPUT_BYTES} bytes]`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
