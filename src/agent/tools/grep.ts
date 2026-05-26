import { z } from "zod";
import { execa } from "execa";
import { tool, type JSONValue } from "ai";
import { compactGrepForModel } from "./model-output";
import {
  resolveInWorkspace,
  SandboxError,
  workspaceRelative,
  workspaceRelativeTo,
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
} from "../sandbox";

const MAX_RESULTS = 80;
const MAX_OUTPUT_BYTES = 64 * 1024;

export function createGrepTool(workspaceRoot?: string) {
  return tool({
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
  toModelOutput: ({ output }) => ({
    type: "json",
    value: compactGrepForModel(output) as JSONValue,
  }),
  execute: async ({ pattern, path: relPath, glob, caseInsensitive }) => {
    try {
      const root = workspaceRoot
        ? ensureWorkspaceRootAt(workspaceRoot)
        : ensureWorkspaceRoot();
      const target = relPath ? resolveInWorkspace(relPath, root) : root;
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
        target: workspaceRoot
          ? workspaceRelativeTo(root, target)
          : workspaceRelative(target),
        matchCount: matches.length,
        truncated: matches.length >= MAX_RESULTS,
        matches,
      };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
  });
}

export const grepTool = createGrepTool();

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
  const rel = file.startsWith(root) ? workspaceRelativeTo(root, file) : file;
  return { file: rel, line: Number.isFinite(lineNo) ? lineNo : 0, text };
}

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
