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
import { findPreview, nearMatchesForFind } from "./edit-diagnostics";
import {
  detectLineEnding,
  normalizeToLF,
  planTextReplacement,
  restoreLineEndings,
} from "./text-edits";
import type { RunCheckpointManager } from "./checkpoints";

export function createReplaceTextTool(
  workspaceRoot?: string,
  checkpoints?: RunCheckpointManager,
) {
  return tool({
    description:
      "Replace one exact text span in an existing UTF-8 file when expectedHash matches. Prefer this for small targeted edits. Requires user approval.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to the workspace root."),
      expectedHash: z
        .string()
        .min(1)
        .describe("SHA-256 from the most recent read_file result."),
      find: z.string().min(1).describe("Exact text to find in the file."),
      replace: z.string().describe("Replacement text."),
      replaceAll: z
        .boolean()
        .optional()
        .describe(
          "Replace every occurrence. Defaults to false and requires exactly one match.",
        ),
      allowGuarded: z
        .boolean()
        .optional()
        .describe(
          "Set true only when intentionally editing a guarded target such as a lockfile, migration, generated file, binary file, or large file.",
        ),
    }),
    toModelOutput: ({ output }) => ({
      type: "json",
      value: compactReplaceTextModelOutput(output),
    }),
    execute: async ({
      path: relPath,
      expectedHash,
      find,
      replace,
      replaceAll = false,
      allowGuarded = false,
    }) => {
      try {
        const abs = resolveInWorkspace(relPath, workspaceRoot);
        const metadata = await assertGuardAllowed({ absPath: abs, relPath, allowGuarded });
        const previous = await readTextFileSnapshot(abs, TEXT_FILE_MAX_BYTES);
        if (previous.sha256 !== expectedHash) {
          return structuredReplaceError({
            code: "HASH_MISMATCH",
            path: relPath,
            expectedHash,
            currentHash: previous.sha256,
            message: `hash mismatch for ${relPath}: expected ${expectedHash}, found ${previous.sha256}`,
          });
        }

        const lineEnding = detectLineEnding(previous.content);
        const plan = planTextReplacement({
          content: normalizeToLF(previous.content),
          find: normalizeToLF(find),
          replace: normalizeToLF(replace),
          replaceAll,
          allowIndentationRecovery: !metadata.guard.guarded && !replaceAll,
          maxBytes: TEXT_FILE_MAX_BYTES,
          recoveryDisabledReason: metadata.guard.guarded
            ? "guarded"
            : replaceAll
              ? "replaceAll"
              : undefined,
        });
        if (!plan.ok) {
          return structuredReplaceError({
            code: plan.code,
            path: relPath,
            expectedHash,
            message: `${relPath} exists and hash matched, but replacement failed: ${plan.message}`,
            find,
            content: previous.content,
          });
        }

        const nextContent = restoreLineEndings(plan.content, lineEnding);
        if (Buffer.byteLength(nextContent, "utf8") > TEXT_FILE_MAX_BYTES) {
          return structuredReplaceError({
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
          replacementCount: plan.replacementCount,
          previousHash: previous.sha256,
          nextHash: sha256(nextContent),
          bytesWritten: Buffer.byteLength(nextContent, "utf8"),
          ...(checkpoint ? { checkpoint } : {}),
          ...(plan.strategy === "indentation"
            ? {
                matchStrategy: "indentation",
                recoveredEditCount: 1,
                matchedLineRanges: plan.matchedLineRange
                  ? [plan.matchedLineRange]
                  : [],
              }
            : {}),
        };
      } catch (err) {
        if (err instanceof SandboxError && err.message.includes("guard")) {
          return structuredReplaceError({
            code: "GUARD_REJECTED",
            path: relPath,
            expectedHash,
            message: err.message,
          });
        }
        return structuredReplaceError({
          code: "WRITE_FAILED",
          path: relPath,
          expectedHash,
          message: errorMessage(err),
        });
      }
    },
  });
}

export const replaceTextTool = createReplaceTextTool();

function structuredReplaceError(input: {
  code:
    | "HASH_MISMATCH"
    | "FIND_NOT_FOUND"
    | "FIND_NOT_UNIQUE"
    | "GUARD_REJECTED"
    | "WRITE_FAILED";
  path: string;
  expectedHash: string;
  currentHash?: string;
  message: string;
  find?: string;
  content?: string;
}) {
  const diagnostics =
    input.code === "FIND_NOT_FOUND" && input.find && input.content
      ? {
          findPreview: findPreview(input.find),
          nearMatches: nearMatchesForFind(input.content, input.find),
        }
      : {};
  return {
    ok: false as const,
    code: input.code,
    path: input.path,
    expectedHash: input.expectedHash,
    ...(input.currentHash ? { currentHash: input.currentHash } : {}),
    message: input.message,
    error: input.message,
    noChangesApplied: true as const,
    ...diagnostics,
  };
}

function compactReplaceTextModelOutput(output: unknown): JSONValue {
  if (!isRecord(output)) {
    return { ok: false, error: "unexpected replace_text output" };
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
      ...(stringValue(output.findPreview)
        ? { findPreview: stringValue(output.findPreview) }
        : {}),
      ...(Array.isArray(output.nearMatches)
        ? { nearMatches: output.nearMatches.slice(0, 5) }
        : {}),
    };
  }
  return {
    ok: true,
    path: stringValue(output.path),
    replacementCount: numberValue(output.replacementCount),
    previousHash: stringValue(output.previousHash),
    nextHash: stringValue(output.nextHash),
    bytesWritten: numberValue(output.bytesWritten),
    ...(numberValue(output.recoveredEditCount) > 0
      ? {
          matchStrategy: stringValue(output.matchStrategy),
          recoveredEditCount: numberValue(output.recoveredEditCount),
          matchedLineRanges: Array.isArray(output.matchedLineRanges)
            ? output.matchedLineRanges.slice(0, 10)
            : [],
        }
      : {}),
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
