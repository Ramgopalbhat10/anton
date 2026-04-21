import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "ai";
import { resolveInWorkspace, SandboxError } from "../sandbox";

const MAX_BYTES = 1024 * 1024;

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
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
      return {
        ok: true as const,
        path: relPath,
        bytesWritten: Buffer.byteLength(content, "utf8"),
      };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
});

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
