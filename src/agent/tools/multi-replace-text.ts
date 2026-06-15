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
  type MatchedLineRange,
} from "./text-edits";

const replacementSchema = z.object({
  find: z.string().min(1).describe("Exact text to find in the file."),
  replace: z.string().describe("Replacement text."),
});

export function createMultiReplaceTextTool(workspaceRoot?: string) {
  return tool({
    description:
      "Apply ordered exact-text replacements to one existing UTF-8 file when expectedHash matches. All replacements run atomically. Requires user approval.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to the workspace root."),
      expectedHash: z
        .string()
        .min(1)
        .describe("SHA-256 from the most recent read_file result."),
      replacements: z
        .array(replacementSchema)
        .min(1)
        .max(20)
        .describe("Ordered find/replace pairs applied sequentially."),
      allowGuarded: z
        .boolean()
        .optional()
        .describe(
          "Set true only when intentionally editing a guarded target such as a lockfile, migration, generated file, binary file, or large file.",
        ),
    }),
    toModelOutput: ({ output }) => ({
      type: "json",
      value: compactMultiReplaceModelOutput(output),
    }),
    execute: async ({ path: relPath, expectedHash, replacements, allowGuarded = false }) => {
      try {
        const abs = resolveInWorkspace(relPath, workspaceRoot);
        const metadata = await assertGuardAllowed({ absPath: abs, relPath, allowGuarded });
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

        const lineEnding = detectLineEnding(previous.content);
        let nextContent = normalizeToLF(previous.content);
        let replacementCount = 0;
        let recoveredEditCount = 0;
        const matchedLineRanges: MatchedLineRange[] = [];
        for (const [index, replacement] of replacements.entries()) {
          const plan = planTextReplacement({
            content: nextContent,
            find: normalizeToLF(replacement.find),
            replace: normalizeToLF(replacement.replace),
            allowIndentationRecovery: !metadata.guard.guarded,
            maxBytes: TEXT_FILE_MAX_BYTES,
            recoveryDisabledReason: metadata.guard.guarded ? "guarded" : undefined,
          });
          if (!plan.ok) {
            return structuredError({
              code: plan.code,
              path: relPath,
              expectedHash,
              message: `${relPath} exists and hash matched, but replacement ${index + 1} failed: ${plan.message}`,
              failedReplacementIndex: index,
              matchedReplacementCount: replacementCount,
              find: replacement.find,
              content: nextContent,
            });
          }
          nextContent = plan.content;
          replacementCount += plan.replacementCount;
          if (plan.strategy === "indentation") {
            recoveredEditCount += 1;
            if (plan.matchedLineRange) {
              matchedLineRanges.push(plan.matchedLineRange);
            }
          }
        }

        const restoredContent = restoreLineEndings(nextContent, lineEnding);
        if (Buffer.byteLength(restoredContent, "utf8") > TEXT_FILE_MAX_BYTES) {
          return structuredError({
            code: "WRITE_FAILED",
            path: relPath,
            expectedHash,
            message: `patched content exceeds ${TEXT_FILE_MAX_BYTES} byte cap`,
          });
        }

        await atomicWriteTextFile(abs, restoredContent);
        return {
          ok: true as const,
          path: relPath,
          replacementCount,
          previousHash: previous.sha256,
          nextHash: sha256(restoredContent),
          bytesWritten: Buffer.byteLength(restoredContent, "utf8"),
          ...(recoveredEditCount > 0
            ? {
                matchStrategy:
                  recoveredEditCount === replacementCount
                    ? "indentation"
                    : "mixed",
                recoveredEditCount,
                matchedLineRanges,
              }
            : {}),
        };
      } catch (err) {
        if (err instanceof SandboxError && err.message.includes("guard")) {
          return structuredError({
            code: "GUARD_REJECTED",
            path: relPath,
            expectedHash,
            message: err.message,
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

export const multiReplaceTextTool = createMultiReplaceTextTool();

function structuredError(input: {
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
  failedReplacementIndex?: number;
  matchedReplacementCount?: number;
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
    ...(input.failedReplacementIndex !== undefined
      ? { failedReplacementIndex: input.failedReplacementIndex }
      : {}),
    ...(input.matchedReplacementCount !== undefined
      ? { matchedReplacementCount: input.matchedReplacementCount }
      : {}),
    ...diagnostics,
  };
}

function compactMultiReplaceModelOutput(output: unknown): JSONValue {
  if (!isRecord(output)) {
    return { ok: false, error: "unexpected multi_replace_text output" };
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
      ...(typeof output.failedReplacementIndex === "number"
        ? { failedReplacementIndex: output.failedReplacementIndex }
        : {}),
      ...(typeof output.matchedReplacementCount === "number"
        ? { matchedReplacementCount: output.matchedReplacementCount }
        : {}),
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
