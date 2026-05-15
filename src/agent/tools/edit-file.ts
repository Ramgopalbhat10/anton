import { z } from "zod";
import { tool, type JSONValue } from "ai";
import { resolveInWorkspace, SandboxError } from "../sandbox";
import {
  TEXT_FILE_MAX_BYTES,
  applySingleFilePatch,
  atomicWriteTextFile,
  exactHunkPatchAlreadyApplied,
  readTextFileSnapshot,
  sha256,
} from "./edit-utils";
import { assertGuardAllowed } from "./file-guardrails";

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
    allowGuarded: z
      .boolean()
      .optional()
      .describe(
        "Set true only when intentionally editing a guarded target such as a lockfile, migration, generated file, binary file, or large file.",
      ),
  }),
  toModelOutput: ({ output }) => ({
    type: "json",
    value: compactEditFileModelOutput(output),
  }),
  execute: async ({ path: relPath, patch, expectedHash, allowGuarded = false }) => {
    try {
      const abs = resolveInWorkspace(relPath, workspaceRoot);
      await assertGuardAllowed({ absPath: abs, relPath, allowGuarded });
      const previous = await readTextFileSnapshot(abs, TEXT_FILE_MAX_BYTES);
      if (previous.sha256 !== expectedHash) {
        if (exactHunkPatchAlreadyApplied({ source: previous.content, patch })) {
          return alreadyAppliedResult(relPath, previous);
        }
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
        if (exactHunkPatchAlreadyApplied({ source: current.content, patch })) {
          return alreadyAppliedResult(relPath, current);
        }
        return {
          ok: false as const,
          error: `hash mismatch for ${relPath}: expected ${expectedHash}, found ${current.sha256}`,
        };
      }

      await atomicWriteTextFile(abs, nextContent);
      return {
        ok: true as const,
        alreadyApplied: false,
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

function alreadyAppliedResult(
  relPath: string,
  snapshot: { content: string; sha256: string },
) {
  return {
    ok: true as const,
    alreadyApplied: true,
    path: relPath,
    previousContent: snapshot.content,
    nextContent: snapshot.content,
    previousHash: snapshot.sha256,
    nextHash: snapshot.sha256,
    bytesWritten: Buffer.byteLength(snapshot.content, "utf8"),
  };
}

function compactEditFileModelOutput(output: unknown): JSONValue {
  if (!isRecord(output)) {
    return { ok: false, error: "unexpected edit_file output" };
  }
  if (output.ok !== true) {
    return {
      ok: false,
      error: typeof output.error === "string" ? output.error : "edit_file failed",
    };
  }
  return {
    ok: true,
    alreadyApplied: booleanValue(output.alreadyApplied),
    path: stringValue(output.path),
    previousHash: stringValue(output.previousHash),
    nextHash: stringValue(output.nextHash),
    bytesWritten: numberValue(output.bytesWritten),
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}
