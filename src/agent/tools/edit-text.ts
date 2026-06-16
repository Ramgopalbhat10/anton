import { createPatch } from "diff";
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
import { applyTextEditsToContent, buildDisplayDiff } from "./text-edits";
import { lintEditedFile } from "./post-edit-lint";
import { modelVisibleToolOutput } from "./model-output";
import type { RunCheckpointManager } from "./checkpoints";

const editSchema = z.object({
  oldText: z.string().describe("Text to find in the current file on disk (LF or CRLF both work)."),
  newText: z.string().describe("Replacement text."),
  replaceAll: z
    .boolean()
    .optional()
    .describe(
      "Replace every occurrence of oldText. Defaults to false and requires a unique match.",
    ),
});

export function createEditTextTool(
  workspaceRoot?: string,
  checkpoints?: RunCheckpointManager,
) {
  return tool({
    description:
      "Apply one or more oldText/newText edits to an existing UTF-8 file. Reads the current file from disk (no read_file hash required). Line-ending differences (CRLF vs LF) are normalized before matching. Returns a compact diff so you can continue editing without re-reading the whole file. Requires user approval.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to the workspace root."),
      edits: z
        .array(editSchema)
        .min(1)
        .max(20)
        .describe("Ordered edits applied atomically against one disk snapshot."),
      allowGuarded: z
        .boolean()
        .optional()
        .describe(
          "Set true only when intentionally editing a guarded target such as a lockfile, migration, generated file, binary file, or large file.",
        ),
    }),
    toModelOutput: ({ output }) => ({
      type: "json",
      value: compactEditTextModelOutput(output),
    }),
    execute: async ({ path: relPath, edits, allowGuarded = false }) => {
      try {
        const abs = resolveInWorkspace(relPath, workspaceRoot);
        const metadata = await assertGuardAllowed({ absPath: abs, relPath, allowGuarded });
        const previous = await readTextFileSnapshot(abs, TEXT_FILE_MAX_BYTES);

        const result = applyTextEditsToContent(previous.content, edits, {
          allowIndentationRecovery: !metadata.guard.guarded,
          maxBytes: TEXT_FILE_MAX_BYTES,
          recoveryDisabledReason: metadata.guard.guarded ? "guarded" : undefined,
        });
        if (!result.ok) {
          const failed = edits[result.index];
          return structuredError({
            code: result.code,
            path: relPath,
            message: `${relPath}: edit ${result.index + 1} failed — ${result.message}`,
            failedEditIndex: result.index,
            find: failed?.oldText,
            content: previous.content,
            currentHash: previous.sha256,
          });
        }

        if (Buffer.byteLength(result.content, "utf8") > TEXT_FILE_MAX_BYTES) {
          return structuredError({
            code: "WRITE_FAILED",
            path: relPath,
            message: `patched content exceeds ${TEXT_FILE_MAX_BYTES} byte cap`,
            currentHash: previous.sha256,
          });
        }

        const checkpoint = await checkpoints?.capturePath(relPath);
        try {
          await atomicWriteTextFile(abs, result.content);
        } catch (err) {
          if (checkpoint) checkpoints?.discardCaptures([checkpoint]);
          throw err;
        }
        const diff = buildDisplayDiff(previous.content, result.content);
        const patch = createPatch(relPath, previous.content, result.content);
        const patchPreview =
          patch.length > 8_000 ? `${patch.slice(0, 8_000)}\n...` : patch;
        const lint = await lintEditedFile(relPath, workspaceRoot);
        if (!lint.ok && !lint.skipped && lint.blocking) {
          await atomicWriteTextFile(abs, previous.content);
          if (checkpoint) checkpoints?.discardCaptures([checkpoint]);
          return structuredError({
            code: "SYNTAX_OR_LINT_FAILED",
            path: relPath,
            message: `${relPath}: edit rolled back — ${lint.summary}`,
            currentHash: previous.sha256,
            lintIssues: lint.issues,
            lintSummary: lint.summary,
            failedPatchPreview: patchPreview,
            postEditLint: "failed_blocking",
            rolledBack: true,
          });
        }

        return {
          ok: true as const,
          path: relPath,
          editCount: edits.length,
          appliedReplacementCount: result.appliedCount,
          previousHash: previous.sha256,
          nextHash: sha256(result.content),
          bytesWritten: Buffer.byteLength(result.content, "utf8"),
          diff,
          patchPreview,
          ...(checkpoint ? { checkpoint } : {}),
          priorReadStale: true as const,
          ...(result.recoveredEditCount > 0
            ? {
                matchStrategy:
                  result.recoveredEditCount === result.appliedCount
                    ? "indentation"
                    : "mixed",
                recoveredEditCount: result.recoveredEditCount,
                matchedLineRanges: result.matchedLineRanges,
              }
            : {}),
          ...(lint.skipped
            ? { postEditLint: "skipped" as const, postEditLintReason: lint.reason }
            : lint.ok
              ? { postEditLint: "passed" as const }
              : {
                  postEditLint: "failed_non_blocking" as const,
                  postEditLintSummary: lint.summary,
                  postEditLintIssues: lint.issues.slice(0, 5),
                }),
        };
      } catch (err) {
        if (err instanceof SandboxError && err.message.includes("guard")) {
          return structuredError({
            code: "GUARD_REJECTED",
            path: relPath,
            message: errorMessage(err),
          });
        }
        return structuredError({
          code: "WRITE_FAILED",
          path: relPath,
          message: errorMessage(err),
        });
      }
    },
  });
}

export const editTextTool = createEditTextTool();

function structuredError(input: {
  code:
    | "FIND_NOT_FOUND"
    | "FIND_NOT_UNIQUE"
    | "GUARD_REJECTED"
    | "WRITE_FAILED"
    | "SYNTAX_OR_LINT_FAILED";
  path: string;
  message: string;
  failedEditIndex?: number;
  find?: string;
  content?: string;
  currentHash?: string;
  lintIssues?: readonly {
    line: number;
    column: number;
    message: string;
    severity?: string;
    category?: string;
    blocking?: boolean;
    ruleId?: string;
  }[];
  lintSummary?: string;
  failedPatchPreview?: string;
  postEditLint?: "failed_blocking";
  rolledBack?: boolean;
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
    message: input.message,
    error: input.message,
    noChangesApplied: true as const,
    ...(input.rolledBack ? { rolledBack: true as const } : {}),
    ...(input.postEditLint ? { postEditLint: input.postEditLint } : {}),
    ...(input.failedEditIndex !== undefined
      ? { failedEditIndex: input.failedEditIndex }
      : {}),
    ...(input.currentHash ? { currentHash: input.currentHash } : {}),
    ...(input.lintSummary ? { lintSummary: input.lintSummary } : {}),
    ...(input.lintIssues?.length
      ? { lintIssues: input.lintIssues.slice(0, 5) }
      : {}),
    ...(input.failedPatchPreview
      ? { failedPatchPreview: input.failedPatchPreview }
      : {}),
    ...diagnostics,
  };
}

function compactEditTextModelOutput(output: unknown): JSONValue {
  if (!isRecord(output)) {
    return modelVisibleToolOutput(output, {
      successCode: "EDIT_TEXT_OK",
      failureCode: "EDIT_TEXT_OUTPUT_MALFORMED",
      successSummary: "Edit applied.",
      failureSummary: "edit_text returned malformed output.",
      failureRecommendedNext: "Retry with a simpler edit or report the tool failure.",
    }) as JSONValue;
  }
  if (output.ok !== true) {
    const code = stringValue(output.code) || "EDIT_TEXT_FAILED";
    return modelVisibleToolOutput({
      ok: false,
      code,
      path: stringValue(output.path),
      message: stringValue(output.message) || stringValue(output.error),
      noChangesApplied: true,
      ...(output.rolledBack === true ? { rolledBack: true } : {}),
      ...(stringValue(output.postEditLint)
        ? { postEditLint: stringValue(output.postEditLint) }
        : {}),
      ...(typeof output.failedEditIndex === "number"
        ? { failedEditIndex: output.failedEditIndex }
        : {}),
      ...(stringValue(output.findPreview)
        ? { findPreview: stringValue(output.findPreview) }
        : {}),
      ...(Array.isArray(output.nearMatches)
        ? { nearMatches: output.nearMatches.slice(0, 5) }
        : {}),
      ...(stringValue(output.lintSummary)
        ? { lintSummary: stringValue(output.lintSummary) }
        : {}),
      ...(Array.isArray(output.lintIssues)
        ? { lintIssues: output.lintIssues.slice(0, 5) }
        : {}),
    }, {
      successCode: "EDIT_TEXT_OK",
      failureCode: "EDIT_TEXT_FAILED",
      successSummary: "Edit applied.",
      failureSummary:
        stringValue(output.message) || stringValue(output.error) || "edit_text failed.",
      failureRecommendedNext: recommendedNextForEditTextFailure(code),
    }) as JSONValue;
  }
  return modelVisibleToolOutput({
    ok: true,
    path: stringValue(output.path),
    editCount: numberValue(output.editCount),
    previousHash: stringValue(output.previousHash),
    nextHash: stringValue(output.nextHash),
    diff: stringValue(output.diff),
    priorReadStale: true,
    ...(numberValue(output.recoveredEditCount) > 0
      ? {
          matchStrategy: stringValue(output.matchStrategy),
          recoveredEditCount: numberValue(output.recoveredEditCount),
          matchedLineRanges: Array.isArray(output.matchedLineRanges)
            ? output.matchedLineRanges.slice(0, 10)
            : [],
        }
      : {}),
    ...(stringValue(output.postEditLint)
      ? { postEditLint: stringValue(output.postEditLint) }
      : {}),
    ...(stringValue(output.postEditLintSummary)
      ? { postEditLintSummary: stringValue(output.postEditLintSummary) }
      : {}),
    ...(Array.isArray(output.postEditLintIssues)
      ? { postEditLintIssues: output.postEditLintIssues.slice(0, 5) }
      : {}),
  }, {
    successCode: "EDIT_TEXT_OK",
    failureCode: "EDIT_TEXT_FAILED",
    successSummary: `Edited ${stringValue(output.path) || "file"}.`,
    failureSummary: "edit_text failed.",
    successRecommendedNext: "Run verification if this changed project files.",
  }) as JSONValue;
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

function recommendedNextForEditTextFailure(code: string): string {
  if (code === "FIND_NOT_FOUND") {
    return "Use nearMatches or re-read the relevant range, then retry with current text.";
  }
  if (code === "FIND_NOT_UNIQUE") {
    return "Include more surrounding context or use replace_lines.";
  }
  if (code === "GUARD_REJECTED") {
    return "Use exact text or replace_lines; automatic recovery is disabled for guarded files.";
  }
  if (code === "SYNTAX_OR_LINT_FAILED") {
    return "Use the lint issues and failed patch preview to make a smaller valid edit.";
  }
  return "Inspect the error, adjust the edit, and retry if appropriate.";
}
