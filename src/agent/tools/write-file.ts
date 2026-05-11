import { z } from "zod";
import { tool } from "ai";
import { resolveInWorkspace, SandboxError } from "../sandbox";
import {
  TEXT_FILE_MAX_BYTES,
  atomicWriteTextFile,
  fileExists,
  readExistingTextPreview,
  readTextFileSnapshot,
  sha256,
} from "./edit-utils";

export function createWriteFileTool(workspaceRoot?: string) {
  return tool({
  description:
    "Write a new UTF-8 text file, or explicitly replace a file when expectedHash matches. Requires user approval.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the workspace root."),
    content: z.string().describe("Full file contents to write."),
    expectedHash: z
      .string()
      .optional()
      .describe(
        "Required when replacing an existing file. SHA-256 from the most recent read_file result.",
      ),
  }),
  execute: async ({ path: relPath, content, expectedHash }) => {
    try {
      if (Buffer.byteLength(content, "utf8") > TEXT_FILE_MAX_BYTES) {
        return {
          ok: false as const,
          error: `content exceeds ${TEXT_FILE_MAX_BYTES} byte cap`,
        };
      }
      const abs = resolveInWorkspace(relPath, workspaceRoot);
      const previous = await readExistingTextPreview(abs);
      if (previous.existed && !expectedHash) {
        return {
          ok: false as const,
          error: "expectedHash is required to replace an existing file",
        };
      }
      if (previous.existed) {
        const current = await readTextFileSnapshot(abs, TEXT_FILE_MAX_BYTES);
        if (current.sha256 !== expectedHash) {
          return {
            ok: false as const,
            error: `hash mismatch for ${relPath}: expected ${expectedHash}, found ${current.sha256}`,
          };
        }
      }
      if (!previous.existed && (await fileExists(abs))) {
        return {
          ok: false as const,
          error: `target already exists: ${relPath}`,
        };
      }
      await atomicWriteTextFile(abs, content);
      return {
        ok: true as const,
        path: relPath,
        bytesWritten: Buffer.byteLength(content, "utf8"),
        existed: previous.existed,
        previousContent: previous.previousContent,
        previousHash: previous.previousHash,
        previousTruncated: previous.previousTruncated,
        nextHash: sha256(content),
      };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
  });
}

export const writeFileTool = createWriteFileTool();

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
