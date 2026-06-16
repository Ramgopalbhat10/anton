import { z } from "zod";
import { tool, type JSONValue } from "ai";
import { resolveInWorkspace, SandboxError } from "../sandbox";
import {
  TEXT_FILE_MAX_BYTES,
  atomicWriteTextFile,
  readTextFileSnapshot,
  sha256,
} from "./edit-utils";
import { assertGuardAllowed } from "./file-guardrails";
import type { RunCheckpointManager } from "./checkpoints";

const editSchema = z.object({
  startLine: z.number().int().min(1).describe("1-indexed first line to replace (inclusive)."),
  endLine: z
    .number()
    .int()
    .min(1)
    .describe("1-indexed last line to replace (inclusive)."),
  replacement: z.string().describe("Replacement text for the line range."),
});

export function createReplaceLinesTool(
  workspaceRoot?: string,
  checkpoints?: RunCheckpointManager,
) {
  return tool({
    description:
      "Replace ordered, non-overlapping line ranges in an existing UTF-8 file when expectedHash matches. Prefer this when exact find strings are brittle. Requires user approval.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to the workspace root."),
      expectedHash: z
        .string()
        .min(1)
        .describe("SHA-256 from the most recent read_file result."),
      edits: z
        .array(editSchema)
        .min(1)
        .max(20)
        .describe("Ordered, non-overlapping line-range replacements."),
      allowGuarded: z
        .boolean()
        .optional()
        .describe(
          "Set true only when intentionally editing a guarded target such as a lockfile, migration, generated file, binary file, or large file.",
        ),
    }),
    toModelOutput: ({ output }) => ({
      type: "json",
      value: compactReplaceLinesModelOutput(output),
    }),
    execute: async ({
      path: relPath,
      expectedHash,
      edits,
      allowGuarded = false,
    }) => {
      try {
        const abs = resolveInWorkspace(relPath, workspaceRoot);
        await assertGuardAllowed({ absPath: abs, relPath, allowGuarded });
        const previous = await readTextFileSnapshot(abs, TEXT_FILE_MAX_BYTES);
        if (previous.sha256 !== expectedHash) {
          return structuredError({
            code: "HASH_MISMATCH",
            path: relPath,
            expectedHash,
            currentHash: previous.sha256,
            message: `hash mismatch for ${relPath}: expected ${expectedHash}, found ${previous.sha256}`,
          });
        }

        const validation = validateEdits(edits, previous.content);
        if (!validation.ok) {
          return structuredError({
            code: validation.code,
            path: relPath,
            expectedHash,
            message: validation.message,
          });
        }

        const nextContent = applyLineEdits(previous.content, validation.normalizedEdits);
        if (Buffer.byteLength(nextContent, "utf8") > TEXT_FILE_MAX_BYTES) {
          return structuredError({
            code: "WRITE_FAILED",
            path: relPath,
            expectedHash,
            message: `patched content exceeds ${TEXT_FILE_MAX_BYTES} byte cap`,
          });
        }

        const checkpoint = await checkpoints?.capturePath(relPath);
        try {
          await atomicWriteTextFile(abs, nextContent);
        } catch (err) {
          if (checkpoint) checkpoints?.discardCaptures([checkpoint]);
          throw err;
        }
        return {
          ok: true as const,
          path: relPath,
          editCount: validation.normalizedEdits.length,
          previousHash: previous.sha256,
          nextHash: sha256(nextContent),
          bytesWritten: Buffer.byteLength(nextContent, "utf8"),
          ...(checkpoint ? { checkpoint } : {}),
          changedRanges: validation.normalizedEdits.map((edit) => ({
            startLine: edit.startLine,
            endLine: edit.endLine,
            previousLineCount: edit.endLine - edit.startLine + 1,
            newLineCount: edit.replacement.split("\n").length,
          })),
        };
      } catch (err) {
        if (err instanceof SandboxError && err.message.includes("guard")) {
          return structuredError({
            code: "GUARD_REJECTED",
            path: relPath,
            expectedHash,
            message: errorMessage(err),
          });
        }
        return structuredError({
          code: "WRITE_FAILED",
          path: relPath,
          expectedHash,
          message: errorMessage(err),
        });
      }
    },
  });
}

export const replaceLinesTool = createReplaceLinesTool();

type NormalizedEdit = {
  startLine: number;
  endLine: number;
  replacement: string;
};

function validateEdits(
  edits: readonly { startLine: number; endLine: number; replacement: string }[],
  content: string,
):
  | { ok: true; normalizedEdits: NormalizedEdit[] }
  | {
      ok: false;
      code: "INVALID_RANGE" | "OVERLAPPING_EDITS";
      message: string;
    } {
  const totalLines = content.split("\n").length;
  const normalized = [...edits].sort((left, right) => left.startLine - right.startLine);
  for (const [index, edit] of normalized.entries()) {
    if (edit.endLine < edit.startLine) {
      return {
        ok: false,
        code: "INVALID_RANGE",
        message: `edit ${index + 1}: endLine ${edit.endLine} is before startLine ${edit.startLine}`,
      };
    }
    if (edit.startLine > totalLines || edit.endLine > totalLines) {
      return {
        ok: false,
        code: "INVALID_RANGE",
        message: `edit ${index + 1}: line range ${edit.startLine}-${edit.endLine} exceeds file length ${totalLines}`,
      };
    }
    const previous = normalized[index - 1];
    if (previous && edit.startLine <= previous.endLine) {
      return {
        ok: false,
        code: "OVERLAPPING_EDITS",
        message: `edit ${index + 1}: line range overlaps the previous edit ending at line ${previous.endLine}`,
      };
    }
  }
  return { ok: true, normalizedEdits: normalized };
}

function applyLineEdits(content: string, edits: readonly NormalizedEdit[]): string {
  const lines = content.split("\n");
  const sorted = [...edits].sort((left, right) => right.startLine - left.startLine);
  for (const edit of sorted) {
    const replacementLines = edit.replacement.split("\n");
    lines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...replacementLines);
  }
  return lines.join("\n");
}

function structuredError(input: {
  code:
    | "HASH_MISMATCH"
    | "INVALID_RANGE"
    | "OVERLAPPING_EDITS"
    | "GUARD_REJECTED"
    | "WRITE_FAILED";
  path: string;
  expectedHash: string;
  currentHash?: string;
  message: string;
}) {
  return {
    ok: false as const,
    code: input.code,
    path: input.path,
    expectedHash: input.expectedHash,
    ...(input.currentHash ? { currentHash: input.currentHash } : {}),
    message: input.message,
    error: input.message,
    noChangesApplied: true as const,
  };
}

function compactReplaceLinesModelOutput(output: unknown): JSONValue {
  if (!isRecord(output)) {
    return { ok: false, error: "unexpected replace_lines output" };
  }
  if (output.ok !== true) {
    return {
      ok: false,
      code: stringValue(output.code),
      path: stringValue(output.path),
      expectedHash: stringValue(output.expectedHash),
      currentHash: stringValue(output.currentHash),
      message: stringValue(output.message) || stringValue(output.error),
      noChangesApplied: true,
    };
  }
  return {
    ok: true,
    path: stringValue(output.path),
    editCount: numberValue(output.editCount),
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
