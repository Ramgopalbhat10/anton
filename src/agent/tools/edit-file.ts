import { z } from "zod";
import { tool } from "ai";
import { resolveInWorkspace, SandboxError } from "../sandbox";
import {
  TEXT_FILE_MAX_BYTES,
  applySingleFilePatch,
  atomicWriteTextFile,
  readTextFileSnapshot,
  sha256,
} from "./edit-utils";

export function createEditFileTool(workspaceRoot?: string) {
  return tool({
  description:
    "Apply a single-file unified diff patch to an existing UTF-8 text file when expectedHash matches. Prefer this for edits to existing files. Requires user approval.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the workspace root."),
    patch: z.string().describe("Single-file unified diff to apply."),
    expectedHash: z
      .string()
      .min(1)
      .describe("SHA-256 from the most recent read_file result."),
  }),
  execute: async ({ path: relPath, patch, expectedHash }) => {
    try {
      const abs = resolveInWorkspace(relPath, workspaceRoot);
      const previous = await readTextFileSnapshot(abs, TEXT_FILE_MAX_BYTES);
      if (previous.sha256 !== expectedHash) {
        return {
          ok: false as const,
          error: `hash mismatch for ${relPath}: expected ${expectedHash}, found ${previous.sha256}`,
        };
      }

      const nextContent = applySingleFilePatch({
        source: previous.content,
        patch,
        relPath,
      });
      if (Buffer.byteLength(nextContent, "utf8") > TEXT_FILE_MAX_BYTES) {
        return {
          ok: false as const,
          error: `patched content exceeds ${TEXT_FILE_MAX_BYTES} byte cap`,
        };
      }

      const current = await readTextFileSnapshot(abs, TEXT_FILE_MAX_BYTES);
      if (current.sha256 !== expectedHash) {
        return {
          ok: false as const,
          error: `hash mismatch for ${relPath}: expected ${expectedHash}, found ${current.sha256}`,
        };
      }

      await atomicWriteTextFile(abs, nextContent);
      return {
        ok: true as const,
        path: relPath,
        previousContent: previous.content,
        nextContent,
        previousHash: previous.sha256,
        nextHash: sha256(nextContent),
        bytesWritten: Buffer.byteLength(nextContent, "utf8"),
      };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
  });
}

export const editFileTool = createEditFileTool();

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
