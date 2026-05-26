import { z } from "zod";
import { tool, type JSONValue } from "ai";
import { resolveInWorkspace, SandboxError } from "../sandbox";
import {
  READ_FILE_MAX_BYTES,
  readTextFileSnapshot,
} from "./edit-utils";
import type { AgentRunProfile } from "../loop";
import {
  compactReadFileForModel,
  readFileDefaultMaxLines,
  readFileReturnsFullByDefault,
  READ_FILE_LOCALIZED_RANGE_MAX_LINES,
} from "./model-output";

export function createReadFileTool(
  workspaceRoot?: string,
  profile: AgentRunProfile = "general-chat",
) {
  const maxLinesDefault = readFileDefaultMaxLines(profile);
  return tool({
  description:
    "Read a UTF-8 text file from the workspace. Supports optional line ranges. Paths are relative to WORKSPACE_ROOT and must stay inside it.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the workspace root."),
    startLine: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("1-indexed first line to return (inclusive). Defaults to 1."),
    endLine: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        `1-indexed last line to return (inclusive). Defaults to startLine + ${maxLinesDefault - 1} for modest files, or a bounded range for large files.`,
      ),
  }),
  toModelOutput: ({ output }) => ({
    type: "json",
    value: compactReadFileForModel(output, profile) as JSONValue,
  }),
  execute: async ({ path: relPath, startLine, endLine }) => {
    try {
      const abs = resolveInWorkspace(relPath, workspaceRoot);
      const snapshot = await readTextFileSnapshot(abs, READ_FILE_MAX_BYTES);
      const raw = snapshot.content;
      const lines = raw.split("\n");
      const totalLines = lines.length;
      const fullByDefault = readFileReturnsFullByDefault(
        profile,
        totalLines,
        snapshot.sizeBytes,
      );
      const from = startLine ?? 1;
      const defaultEnd = fullByDefault
        ? totalLines
        : Math.min(
            totalLines,
            from + (profile === "localized-edit"
              ? READ_FILE_LOCALIZED_RANGE_MAX_LINES
              : maxLinesDefault) - 1,
          );
      const to = endLine ?? defaultEnd;
      const slice = lines.slice(from - 1, to);
      const truncated = from > 1 || to < totalLines;
      return {
        ok: true as const,
        path: relPath,
        startLine: from,
        endLine: Math.min(to, totalLines),
        totalLines,
        sizeBytes: snapshot.sizeBytes,
        sha256: snapshot.sha256,
        content: slice.join("\n"),
        ...(truncated
          ? {
              truncated: true as const,
              hasMoreBefore: from > 1,
              hasMoreAfter: to < totalLines,
              nextStartLine: to < totalLines ? to + 1 : undefined,
              nextEndLine:
                to < totalLines
                  ? Math.min(
                      totalLines,
                      to + READ_FILE_LOCALIZED_RANGE_MAX_LINES,
                    )
                  : undefined,
            }
          : {}),
      };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
  });
}

export const readFileTool = createReadFileTool();

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
