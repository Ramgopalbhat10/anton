import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "ai";
import { resolveInWorkspace, SandboxError } from "../sandbox";

const MAX_BYTES = 1024 * 1024;
// Cap previous content captured for diffing so the tool result stays compact.
const PREVIEW_BYTES = 128 * 1024;

export const writeFileTool = tool({
  description:
    "Write a UTF-8 text file inside the workspace, creating parent directories as needed. Overwrites existing files. Requires user approval.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the workspace root."),
    content: z.string().describe("Full file contents to write."),
  }),
  needsApproval: true,
  execute: async ({ path: relPath, content }) => {
    try {
      if (Buffer.byteLength(content, "utf8") > MAX_BYTES) {
        return {
          ok: false as const,
          error: `content exceeds ${MAX_BYTES} byte cap`,
        };
      }
      const abs = resolveInWorkspace(relPath);
      const { existed, previousContent, previousTruncated } =
        await readPreviousContent(abs);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
      return {
        ok: true as const,
        path: relPath,
        bytesWritten: Buffer.byteLength(content, "utf8"),
        existed,
        previousContent,
        previousTruncated,
      };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
});

async function readPreviousContent(abs: string): Promise<{
  existed: boolean;
  previousContent: string;
  previousTruncated: boolean;
}> {
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      return { existed: false, previousContent: "", previousTruncated: false };
    }
    if (stat.size > PREVIEW_BYTES) {
      // File exists but is too large to capture inline — still record the
      // write, but omit the diff base to keep tool results small.
      return { existed: true, previousContent: "", previousTruncated: true };
    }
    const previous = await fs.readFile(abs, "utf8");
    return {
      existed: true,
      previousContent: previous,
      previousTruncated: false,
    };
  } catch (err) {
    if (isNotFound(err)) {
      return { existed: false, previousContent: "", previousTruncated: false };
    }
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
