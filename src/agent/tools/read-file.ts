import { z } from "zod";
import fs from "node:fs/promises";
import { tool } from "ai";
import { resolveInWorkspace, SandboxError } from "../sandbox";

const MAX_BYTES = 256 * 1024;
const MAX_LINES_DEFAULT = 2000;

export function createReadFileTool(workspaceRoot?: string) {
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
        "1-indexed last line to return (inclusive). Defaults to startLine + 2000.",
      ),
  }),
  execute: async ({ path: relPath, startLine, endLine }) => {
    try {
      const abs = resolveInWorkspace(relPath, workspaceRoot);
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        return { ok: false as const, error: `not a file: ${relPath}` };
      }
      if (stat.size > MAX_BYTES) {
        return {
          ok: false as const,
          error: `file too large (${stat.size} bytes, cap ${MAX_BYTES}). Use grep or narrow with startLine/endLine.`,
        };
      }
      const raw = await fs.readFile(abs, "utf8");
      const lines = raw.split("\n");
      const from = startLine ?? 1;
      const to = endLine ?? Math.min(lines.length, from + MAX_LINES_DEFAULT - 1);
      const slice = lines.slice(from - 1, to);
      return {
        ok: true as const,
        path: relPath,
        startLine: from,
        endLine: Math.min(to, lines.length),
        totalLines: lines.length,
        content: slice.join("\n"),
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
