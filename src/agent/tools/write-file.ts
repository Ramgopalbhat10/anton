import { z } from "zod";
import { tool, type JSONValue } from "ai";
import { resolveInWorkspace, SandboxError } from "../sandbox";
import {
  TEXT_FILE_MAX_BYTES,
  createTextFileExclusive,
  readExistingTextPreview,
  sha256,
} from "./edit-utils";
import {
  assertPathGuardAllowed,
} from "./file-guardrails";
import { modelVisibleToolOutput } from "./model-output";

export function createWriteFileTool(workspaceRoot?: string) {
  return tool({
  description:
    "Create a new small UTF-8 text file. Existing files are rejected; use edit_text for surgical edits or edit_file for large structural rewrites. Requires user approval.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the workspace root."),
    content: z.string().describe("Full file contents to write."),
    expectedHash: z
      .string()
      .optional()
      .describe(
        "Required when replacing an existing file. SHA-256 from the most recent read_file result.",
      ),
    allowGuarded: z
      .boolean()
      .optional()
      .describe(
        "Set true only when intentionally writing a guarded target such as a lockfile, migration, generated file, binary file, or large file.",
      ),
  }),
  toModelOutput: ({ output }) => ({
    type: "json",
    value: compactWriteFileModelOutput(output),
  }),
  execute: async ({ path: relPath, content, allowGuarded = false }) => {
    try {
      if (Buffer.byteLength(content, "utf8") > TEXT_FILE_MAX_BYTES) {
        return {
          ok: false as const,
          error: `content exceeds ${TEXT_FILE_MAX_BYTES} byte cap`,
        };
      }
      const abs = resolveInWorkspace(relPath, workspaceRoot);
      assertPathGuardAllowed({ relPath, allowGuarded });
      const previous = await readExistingTextPreview(abs);
      if (previous.existed) {
        return {
          ok: false as const,
          code: "WRITE_FILE_EXISTING_FILE_REJECTED",
          error: `write_file cannot replace existing files: ${relPath}`,
          recommendedNext:
            "Use edit_text for surgical edits, or edit_file for large structural rewrites.",
        };
      }
      await createTextFileExclusive(abs, content);
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
      const message = errorMessage(err);
      if (message.includes("EEXIST")) {
        return {
          ok: false as const,
          code: "WRITE_FILE_EXISTING_FILE_REJECTED",
          error: `write_file cannot replace existing files: ${relPath}`,
          recommendedNext:
            "Use edit_text for surgical edits, or edit_file for large structural rewrites.",
        };
      }
      return { ok: false as const, error: message };
    }
  },
  });
}

export const writeFileTool = createWriteFileTool();

function compactWriteFileModelOutput(output: unknown): JSONValue {
  if (!isRecord(output)) {
    return modelVisibleToolOutput(output, {
      successCode: "WRITE_FILE_OK",
      failureCode: "WRITE_FILE_OUTPUT_MALFORMED",
      successSummary: "File written.",
      failureSummary: "write_file returned malformed output.",
      failureRecommendedNext: "Retry with a smaller, explicit write or report the tool failure.",
    }) as JSONValue;
  }
  if (output.ok !== true) {
    const error = typeof output.error === "string" ? output.error : "write_file failed";
    return modelVisibleToolOutput({
      ok: false,
      code:
        typeof output.code === "string" && output.code.length > 0
          ? output.code
          : writeFileFailureCode(error),
      error,
      recommendedNext:
        typeof output.recommendedNext === "string"
          ? output.recommendedNext
          : recommendedNextForWriteFileFailure(error),
    }, {
      successCode: "WRITE_FILE_OK",
      failureCode: "WRITE_FILE_FAILED",
      successSummary: "File created.",
      failureSummary: error,
      failureRecommendedNext: recommendedNextForWriteFileFailure(error),
    }) as JSONValue;
  }
  return modelVisibleToolOutput({
    ok: true,
    path: stringValue(output.path),
    bytesWritten: numberValue(output.bytesWritten),
    existed: booleanValue(output.existed),
    previousHash:
      typeof output.previousHash === "string" ? output.previousHash : null,
    previousTruncated: booleanValue(output.previousTruncated),
    nextHash: stringValue(output.nextHash),
  }, {
    successCode: "WRITE_FILE_OK",
    failureCode: "WRITE_FILE_FAILED",
    successSummary: `Created ${stringValue(output.path) || "file"}.`,
    failureSummary: "write_file failed.",
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

function booleanValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function writeFileFailureCode(error: string): string {
  if (error.includes("cannot replace existing files")) {
    return "WRITE_FILE_EXISTING_FILE_REJECTED";
  }
  if (error.includes("byte cap")) return "WRITE_FILE_TOO_LARGE";
  if (error.toLowerCase().includes("guard")) return "WRITE_FILE_GUARD_REJECTED";
  return "WRITE_FILE_FAILED";
}

function recommendedNextForWriteFileFailure(error: string): string {
  const code = writeFileFailureCode(error);
  if (code === "WRITE_FILE_EXISTING_FILE_REJECTED") {
    return "Use edit_text for surgical edits, or edit_file for large structural rewrites.";
  }
  if (code === "WRITE_FILE_TOO_LARGE") {
    return "Create a smaller new file, or use edit_file for a large structural rewrite of an existing file.";
  }
  if (code === "WRITE_FILE_GUARD_REJECTED") {
    return "Set allowGuarded only if creating this guarded file is intentional.";
  }
  return "Inspect the error, adjust the write, and retry if appropriate.";
}
