import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { tool, type JSONValue } from "ai";
import { compactGlobForModel } from "./model-output";
import {
  resolveInWorkspace,
  SandboxError,
  workspaceRelative,
  workspaceRelativeTo,
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
} from "../sandbox";

const MAX_RESULTS = 200;
const MAX_ENTRIES_SCANNED = 20_000;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
]);

export function createGlobTool(workspaceRoot?: string) {
  return tool({
  description:
    "List files in the workspace that match a glob pattern. Supports `*` (single segment wildcard) and `**` (any depth). Paths in results are relative to WORKSPACE_ROOT.",
  inputSchema: z.object({
    pattern: z
      .string()
      .describe(
        "Glob pattern to match, e.g. `**/*.ts`, `src/**/*.tsx`, `*.md`.",
      ),
    path: z
      .string()
      .optional()
      .describe(
        "Optional subdirectory (relative to workspace root) to search in. Defaults to the workspace root.",
      ),
  }),
  toModelOutput: ({ output }) => ({
    type: "json",
    value: compactGlobForModel(output) as JSONValue,
  }),
  execute: async ({ pattern, path: relPath }) => {
    try {
      const root = workspaceRoot
        ? ensureWorkspaceRootAt(workspaceRoot)
        : ensureWorkspaceRoot();
      const base = relPath ? resolveInWorkspace(relPath, root) : root;
      const regex = globToRegex(pattern);
      const matches: string[] = [];
      let scanned = 0;

      async function walk(dir: string): Promise<void> {
        if (matches.length >= MAX_RESULTS || scanned >= MAX_ENTRIES_SCANNED) {
          return;
        }
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (matches.length >= MAX_RESULTS) return;
          scanned += 1;
          if (scanned > MAX_ENTRIES_SCANNED) return;
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            await walk(abs);
            continue;
          }
          if (!entry.isFile()) continue;
          const rel = path.relative(base, abs);
          const normalized = rel.split(path.sep).join("/");
          if (regex.test(normalized)) {
            matches.push(
              workspaceRoot
                ? workspaceRelativeTo(root, abs)
                : workspaceRelative(abs),
            );
          }
        }
      }

      await walk(base);

      return {
        ok: true as const,
        pattern,
        base: workspaceRoot
          ? workspaceRelativeTo(root, base)
          : workspaceRelative(base),
        matchCount: matches.length,
        truncated: matches.length >= MAX_RESULTS,
        matches: matches.sort(),
      };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
  });
}

export const globTool = createGlobTool();

// Very small glob -> regex converter. Handles `*`, `**`, `?`, and literal
// segments. Does not implement brace expansion or character classes.
export function globToRegex(pattern: string): RegExp {
  const normalized = pattern.split(path.sep).join("/");
  let out = "^";
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === "*") {
      if (normalized[i + 1] === "*") {
        // `**` — any number of path segments
        out += ".*";
        i += 1;
        if (normalized[i + 1] === "/") i += 1;
      } else {
        // `*` — any characters except `/`
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if ("\\.^$+|(){}[]".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  out += "$";
  return new RegExp(out);
}

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
