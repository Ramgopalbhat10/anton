import { z } from "zod";
import { tool, type JSONValue } from "ai";
import { resolveInWorkspace, SandboxError } from "../sandbox";
import {
  TEXT_FILE_MAX_BYTES,
  atomicWriteTextFile,
  fileExists,
  readExistingTextPreview,
  readTextFileSnapshot,
  sha256,
} from "./edit-utils";
import {
  assertGuardAllowed,
  assertPathGuardAllowed,
} from "./file-guardrails";
import { modelVisibleToolOutput } from "./model-output";

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
  execute: async ({ path: relPath, content, expectedHash, allowGuarded = false }) => {
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
      if (previous.existed && !expectedHash) {
        return {
          ok: false as const,
          error: "expectedHash is required to replace an existing file",
        };
      }
      if (previous.existed) {
        await assertGuardAllowed({ absPath: abs, relPath, allowGuarded });
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
      code: writeFileFailureCode(error),
      error,
    }, {
      successCode: "WRITE_FILE_OK",
      failureCode: "WRITE_FILE_FAILED",
      successSummary: "File written.",
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
    successSummary: `Wrote ${stringValue(output.path) || "file"}.`,
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
  if (error.includes("expectedHash is required")) return "WRITE_FILE_EXPECTED_HASH_REQUIRED";
  if (error.includes("hash mismatch")) return "WRITE_FILE_HASH_MISMATCH";
  if (error.includes("target already exists")) return "WRITE_FILE_TARGET_EXISTS";
  if (error.includes("byte cap")) return "WRITE_FILE_TOO_LARGE";
  if (error.toLowerCase().includes("guard")) return "WRITE_FILE_GUARD_REJECTED";
  return "WRITE_FILE_FAILED";
}

function recommendedNextForWriteFileFailure(error: string): string {
  const code = writeFileFailureCode(error);
  if (code === "WRITE_FILE_EXPECTED_HASH_REQUIRED") {
    return "Read the current file first, then retry with expectedHash or use edit_text.";
  }
  if (code === "WRITE_FILE_HASH_MISMATCH") {
    return "Re-read the file and retry only after reconciling the current content.";
  }
  if (code === "WRITE_FILE_TARGET_EXISTS") {
    return "Use expectedHash for replacement or choose a new path.";
  }
  if (code === "WRITE_FILE_TOO_LARGE") {
    return "Use a smaller targeted edit or split the write.";
  }
  if (code === "WRITE_FILE_GUARD_REJECTED") {
    return "Set allowGuarded only if this guarded write is intentional.";
  }
  return "Inspect the error, adjust the write, and retry if appropriate.";
}
