import { z } from "zod";
import { execa } from "execa";
import { tool } from "ai";
import {
  resolveInWorkspace,
  SandboxError,
  workspaceRelative,
  ensureWorkspaceRoot,
} from "../sandbox";

const MAX_RESULTS = 200;
const MAX_OUTPUT_BYTES = 64 * 1024;

export const grepTool = tool({
  description:
    "Search the workspace with ripgrep. Returns matching lines with their file path and line number. Use this instead of reading large files.",
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern (ripgrep syntax)."),
    path: z
      .string()
      .optional()
      .describe(
        "Optional file or directory (relative to workspace root) to search. Defaults to the whole workspace.",
      ),
    glob: z
      .string()
      .optional()
      .describe(
        "Optional ripgrep glob filter, e.g. `*.ts` or `src/**/*.tsx`. Can be repeated with commas.",
      ),
    caseInsensitive: z
      .boolean()
      .optional()
      .describe("Match case-insensitively. Defaults to false."),
  }),
  execute: async ({ pattern, path: relPath, glob, caseInsensitive }) => {
    try {
      const root = ensureWorkspaceRoot();
      const target = relPath ? resolveInWorkspace(relPath) : root;
      const args = [
        "--line-number",
        "--no-heading",
        "--color=never",
        `--max-count=${MAX_RESULTS}`,
        "--max-filesize=1M",
      ];
      if (caseInsensitive) args.push("--ignore-case");
      if (glob) {
        for (const g of glob.split(",").map((s) => s.trim()).filter(Boolean)) {
          args.push("--glob", g);
        }
      }
      args.push("--", pattern, target);

      const result = await execa("rg", args, {
        cwd: root,
        reject: false,
        maxBuffer: MAX_OUTPUT_BYTES * 4,
      });

      if (result.exitCode === 2) {
        return {
          ok: false as const,
          error: result.stderr?.trim() || "ripgrep failed",
        };
      }

      const rawLines = (result.stdout ?? "")
        .split("\n")
        .filter((line) => line.length > 0)
        .slice(0, MAX_RESULTS);

      const matches = rawLines.map((line) => parseRgLine(line, root));

      return {
        ok: true as const,
        pattern,
        target: workspaceRelative(target),
        matchCount: matches.length,
        truncated: matches.length >= MAX_RESULTS,
        matches,
      };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
});

function parseRgLine(
  line: string,
  root: string,
): { file: string; line: number; text: string } {
  // rg output: <path>:<line>:<match>
  const first = line.indexOf(":");
  const second = first === -1 ? -1 : line.indexOf(":", first + 1);
  if (first === -1 || second === -1) {
    return { file: "", line: 0, text: line };
  }
  const file = line.slice(0, first);
  const lineNo = Number.parseInt(line.slice(first + 1, second), 10);
  const text = line.slice(second + 1);
  const rel = file.startsWith(root) ? workspaceRelative(file) : file;
  return { file: rel, line: Number.isFinite(lineNo) ? lineNo : 0, text };
}

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
