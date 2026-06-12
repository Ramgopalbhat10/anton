import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { tool, type JSONValue } from "ai";
import { globToRegex } from "./glob";
import { compactGrepForModel } from "./model-output";
import { runWorkspaceProcess } from "@/src/workspace/process-runner";
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
const MAX_FALLBACK_FILES = 5_000;

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

      const result = await runWorkspaceProcess("rg", args, root, {
        outputCapBytes: MAX_OUTPUT_BYTES,
      });

      if (result.exitCode === 2) {
        return {
          ok: false as const,
          error: result.stderr.trim() || "ripgrep failed",
        };
      }

      const rawLines = result.stdout
        .split("\n")
        .filter((line) => line.length > 0)
        .slice(0, MAX_RESULTS);

      const rgMatches = rawLines.map((line) => parseRgLine(line, root));
      const matches =
        rgMatches.length > 0
          ? rgMatches
          : await fallbackSearch({
              root,
              target,
              pattern,
              glob,
              caseInsensitive: caseInsensitive === true,
            });

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

async function fallbackSearch({
  root,
  target,
  pattern,
  glob,
  caseInsensitive,
}: {
  root: string;
  target: string;
  pattern: string;
  glob?: string;
  caseInsensitive: boolean;
}): Promise<{ file: string; line: number; text: string }[]> {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, caseInsensitive ? "i" : "");
  } catch {
    return [];
  }

  const globRegexes = glob
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(globToRegex);
  const files = await collectSearchFiles(root, target, globRegexes);
  const matches: { file: string; line: number; text: string }[] = [];

  for (const file of files) {
    if (matches.length >= MAX_RESULTS) break;
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;

    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      regex.lastIndex = 0;
      if (!regex.test(line)) continue;
      matches.push({
        file: workspaceRelativeTo(root, file),
        line: index + 1,
        text: line,
      });
      if (matches.length >= MAX_RESULTS) break;
    }
  }

  return matches;
}

async function collectSearchFiles(
  root: string,
  target: string,
  globRegexes: RegExp[] | undefined,
): Promise<string[]> {
  const stat = await fs.stat(target);
  if (stat.isFile()) {
    return fileMatchesGlob(root, target, globRegexes) ? [target] : [];
  }
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  await walkSearchDirectory(root, target, globRegexes, files);
  return files;
}

async function walkSearchDirectory(
  root: string,
  directory: string,
  globRegexes: RegExp[] | undefined,
  files: string[],
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= MAX_FALLBACK_FILES) return;
    if (shouldSkipSearchEntry(entry.name)) continue;

    const nextPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkSearchDirectory(root, nextPath, globRegexes, files);
      continue;
    }
    if (entry.isFile() && fileMatchesGlob(root, nextPath, globRegexes)) {
      files.push(nextPath);
    }
  }
}

function fileMatchesGlob(
  root: string,
  file: string,
  globRegexes: RegExp[] | undefined,
): boolean {
  if (!globRegexes || globRegexes.length === 0) return true;
  const relative = workspaceRelativeTo(root, file).replaceAll(path.sep, "/");
  return globRegexes.some((regex) => regex.test(relative));
}

function shouldSkipSearchEntry(name: string): boolean {
  return [".git", "node_modules", ".next", "dist", "build"].includes(name);
}
