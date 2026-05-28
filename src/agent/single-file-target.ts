import fs from "node:fs";
import path from "node:path";

import { resolveInWorkspace, workspaceRelativeTo } from "./sandbox";

export type SingleFileTargetResolution =
  | {
      targetResolution: "exact" | "unique_search";
      targetPath: string;
      targetResolutionReason: string;
      candidates: string[];
    }
  | {
      targetResolution: "unresolved" | "ambiguous";
      targetResolutionReason: string;
      candidates: string[];
    };

const FILE_TOKEN_PATTERN =
  /(?:^|[\s("'`])((?:[A-Za-z0-9_.@-]+[\\/])+[A-Za-z0-9_.@-]+\.[A-Za-z0-9]+|[A-Za-z0-9_.@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|scss|md|mdx|json|jsonc|yml|yaml|toml|sql|txt|html|tsx?))(?:$|[\s)"'`,:;!?])/gi;

const CODE_SPAN_PATTERN = /`([^`\r\n]+)`/g;

const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

const GENERATED_DIRS = new Set([
  "generated",
  ".generated",
  "__generated__",
]);

const MAX_DIRS_VISITED = 1_000;
const MAX_FILES_VISITED = 5_000;
const MAX_MATCHES = 20;

export function resolveSingleFileTarget(
  latestUserText: string,
  workspaceRoot: string | undefined,
): SingleFileTargetResolution {
  const candidates = extractUserNamedFileCandidates(latestUserText);
  if (candidates.length === 0) {
    return {
      targetResolution: "unresolved",
      targetResolutionReason: "single-file target unresolved: no file-like candidate was named",
      candidates,
    };
  }

  const root = workspaceRoot ? path.resolve(workspaceRoot) : undefined;
  if (!root) {
    return {
      targetResolution: "unresolved",
      targetResolutionReason: "single-file target unresolved: no workspace root is available",
      candidates,
    };
  }

  const exactMatches = uniqueStrings(
    candidates.flatMap((candidate) => exactWorkspaceFile(candidate, root)),
  );
  if (exactMatches.length === 1) {
    return {
      targetResolution: "exact",
      targetPath: exactMatches[0],
      targetResolutionReason: `exact workspace-relative path \`${exactMatches[0]}\``,
      candidates,
    };
  }
  if (exactMatches.length > 1) {
    return {
      targetResolution: "ambiguous",
      targetResolutionReason: `single-file target ambiguous: ${exactMatches.length} exact paths were named`,
      candidates: exactMatches,
    };
  }

  const searchMatches = uniqueStrings(
    candidates.flatMap((candidate) => searchWorkspaceForCandidate(candidate, root)),
  );
  if (searchMatches.length === 1) {
    return {
      targetResolution: "unique_search",
      targetPath: searchMatches[0],
      targetResolutionReason: `unique bounded filename search match for \`${candidates[0]}\``,
      candidates,
    };
  }
  if (searchMatches.length > 1) {
    return {
      targetResolution: "ambiguous",
      targetResolutionReason: `single-file target ambiguous: ${searchMatches.length} bounded search matches`,
      candidates: searchMatches.slice(0, MAX_MATCHES),
    };
  }

  return {
    targetResolution: "unresolved",
    targetResolutionReason: `single-file target unresolved: no workspace file matched ${formatCandidateList(candidates)}`,
    candidates,
  };
}

export function singleFileTargetContext(
  resolution: Extract<
    SingleFileTargetResolution,
    { targetResolution: "exact" | "unique_search" }
  >,
): string {
  return [
    "Model-only target context for this run:",
    `Resolved target path: \`${resolution.targetPath}\`.`,
    `Resolution source: ${resolution.targetResolution}.`,
    "Use `read_file` on this exact path first. Use `edit_text` only on this path. Run `verify` after a successful edit before final.",
  ].join("\n");
}

function extractUserNamedFileCandidates(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(CODE_SPAN_PATTERN)) {
    const value = normalizeCandidate(match[1]);
    if (value && isFileLikeCandidate(value)) found.push(value);
  }
  for (const match of text.matchAll(FILE_TOKEN_PATTERN)) {
    const value = normalizeCandidate(match[1]);
    if (value && isFileLikeCandidate(value)) found.push(value);
  }
  return uniqueStrings(found);
}

function exactWorkspaceFile(candidate: string, root: string): string[] {
  try {
    const abs = resolveInWorkspace(candidate, root);
    const stat = fs.statSync(abs, { throwIfNoEntry: false });
    if (!stat?.isFile()) return [];
    return [toWorkspacePath(root, abs)];
  } catch {
    return [];
  }
}

function searchWorkspaceForCandidate(candidate: string, root: string): string[] {
  const normalized = normalizePath(candidate);
  const basename = path.basename(normalized).toLowerCase();
  const hasDirectoryHint = normalized.includes("/");
  const matches: string[] = [];
  let dirsVisited = 0;
  let filesVisited = 0;
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;
    dirsVisited += 1;
    if (dirsVisited > MAX_DIRS_VISITED || filesVisited > MAX_FILES_VISITED) break;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldIgnoreDir(entry.name)) pending.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      filesVisited += 1;
      if (entry.name.toLowerCase() !== basename) continue;
      const rel = normalizePath(toWorkspacePath(root, abs));
      if (hasDirectoryHint && rel !== normalized && !rel.endsWith(`/${normalized}`)) {
        continue;
      }
      matches.push(rel);
      if (matches.length >= MAX_MATCHES) return matches;
    }
  }

  return matches;
}

function shouldIgnoreDir(name: string): boolean {
  const normalized = name.toLowerCase();
  return IGNORED_DIRS.has(normalized) || GENERATED_DIRS.has(normalized);
}

function isFileLikeCandidate(value: string): boolean {
  if (value.includes("..") || path.isAbsolute(value)) return false;
  if (!/[A-Za-z0-9_-]\.[A-Za-z0-9]+$/.test(value)) return false;
  if (/^(https?|file):/i.test(value)) return false;
  return true;
}

function normalizeCandidate(value: string): string | undefined {
  const trimmed = value
    .trim()
    .replace(/[.,;:!?)]$/, "")
    .replace(/^["'(<]+/, "")
    .replace(/[>"')]+$/, "");
  if (!trimmed) return undefined;
  return normalizePath(trimmed);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function toWorkspacePath(root: string, abs: string): string {
  return normalizePath(workspaceRelativeTo(root, abs));
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function formatCandidateList(candidates: readonly string[]): string {
  return candidates.map((candidate) => `\`${candidate}\``).join(", ");
}
