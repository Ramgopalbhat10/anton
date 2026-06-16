import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { buildBashEnvironment } from "./command-policy";
import { ensureWorkspaceRootAt } from "./sandbox";
import { redactText } from "@/src/lib/redaction";

const DEFAULT_WORKSPACE_CONTEXT_CHARS = 6_000;
const MAX_REPO_MAP_ENTRIES = 80;
const MAX_REPO_MAP_DEPTH = 4;
const MAX_SELECTED_FILES = 8;
const MAX_FOUNDATIONAL_FILES = 3;
const MAX_IMPORT_NEIGHBOR_CANDIDATES = 12;
const MAX_FILE_READ_CHARS = 12_000;
const MAX_FILE_SUMMARY_CHARS = 350;

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "workspace",
]);

const SKIPPED_FILES = new Set([
  "anton.db",
  "anton.db-shm",
  "anton.db-wal",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const FOUNDATIONAL_CONTEXT_FILES = [
  "AGENTS.md",
  "package.json",
  "ROADMAP.md",
] as const;

const JS_TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];

const SUMMARIZABLE_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

type RepoMapEntry = {
  path: string;
  kind: "directory" | "file";
};

type GitSummary = {
  branch?: string;
  statusLines: string[];
  diffStat?: string;
  stagedDiffStat?: string;
};

type SelectedReason =
  | "foundational"
  | "path-mention"
  | "basename-mention"
  | "git-changed"
  | "recent"
  | "import-neighbor"
  | "keyword";

type SelectedFile = {
  path: string;
  reasons: SelectedReason[];
};

export function buildWorkspaceContextDigest({
  workspaceRoot,
  latestUserText,
  recentFiles = [],
  budgetChars = DEFAULT_WORKSPACE_CONTEXT_CHARS,
}: {
  workspaceRoot: string | undefined;
  latestUserText: string;
  recentFiles?: readonly string[];
  budgetChars?: number;
}): string | undefined {
  if (!workspaceRoot || budgetChars <= 0) return undefined;

  try {
    const root = ensureWorkspaceRootAt(workspaceRoot);
    const repoMap = buildRepoMap(root);
    const git = gitSummary(root);
    const selectedFiles = selectFilesForSummary({
      root,
      repoMap,
      latestUserText,
      recentFiles,
      git,
    });

    const blocks = [
      "Workspace context:",
      "Use this compact repo snapshot to choose files and commands. Re-read files before editing or when exact content matters.",
      git ? gitBlock(git) : undefined,
      selectedFilesBlock(root, selectedFiles),
      repoMapBlock(repoMap),
    ].filter((block): block is string => Boolean(block?.trim()));

    const digest = compactBlock(blocks.join("\n\n"), budgetChars);
    return digest.trim() ? digest : undefined;
  } catch (err) {
    return `Workspace context unavailable: ${compactLine(errorMessage(err), 400)}`;
  }
}

function buildRepoMap(root: string): RepoMapEntry[] {
  const entries: RepoMapEntry[] = [];
  visitDirectory(root, ".", 0, entries);
  return entries;
}

function visitDirectory(
  root: string,
  relativeDir: string,
  depth: number,
  entries: RepoMapEntry[],
): void {
  if (entries.length >= MAX_REPO_MAP_ENTRIES || depth > MAX_REPO_MAP_DEPTH) {
    return;
  }

  const absoluteDir = path.join(root, relativeDir);
  const children = safeReadDir(absoluteDir)
    .filter((entry) => !shouldSkipPath(entry.name))
    .sort(compareDirents);

  for (const child of children) {
    if (entries.length >= MAX_REPO_MAP_ENTRIES) return;
    const childRelative = normalizeRelative(path.join(relativeDir, child.name));
    if (child.isDirectory()) {
      entries.push({ path: `${childRelative}/`, kind: "directory" });
      visitDirectory(root, childRelative, depth + 1, entries);
      continue;
    }
    if (child.isFile() && isSummarizablePath(childRelative)) {
      entries.push({ path: childRelative, kind: "file" });
    }
  }
}

function selectFilesForSummary({
  root,
  repoMap,
  latestUserText,
  recentFiles,
  git,
}: {
  root: string;
  repoMap: RepoMapEntry[];
  latestUserText: string;
  recentFiles: readonly string[];
  git: GitSummary | undefined;
}): SelectedFile[] {
  const selected = new Map<string, SelectedFile>();
  for (const file of FOUNDATIONAL_CONTEXT_FILES.slice(0, MAX_FOUNDATIONAL_FILES)) {
    if (isSafeReadableFile(root, file)) {
      selected.set(file, { path: file, reasons: ["foundational"] });
    }
  }

  const repoFiles = repoMap
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.path);
  const explicitPaths = explicitRequestPaths(latestUserText);
  const mentionedBasenames = mentionedBasenameSet(latestUserText);
  const basenameMentionedPaths = repoFiles.filter((file) =>
    mentionedBasenames.has(path.basename(file).toLowerCase()),
  );
  const changedPaths = changedPathsFromStatusLines(git?.statusLines ?? []);
  const normalizedRecentFiles = normalizeSignalPaths(recentFiles);
  const stronglySignaledPaths = uniqueStrings([
    ...explicitPaths,
    ...basenameMentionedPaths,
    ...changedPaths,
    ...normalizedRecentFiles,
  ]);
  const importNeighbors = importNeighborCandidates(root, stronglySignaledPaths);
  const candidatePaths = uniqueStrings([
    ...repoFiles,
    ...explicitPaths,
    ...changedPaths,
    ...normalizedRecentFiles,
    ...importNeighbors,
  ]);
  const explicitPathSet = new Set(explicitPaths);
  const changedPathSet = new Set(changedPaths);
  const recentPathSet = new Set(normalizedRecentFiles);
  const importNeighborSet = new Set(importNeighbors);
  const keywords = keywordsFor(latestUserText);

  const scored = candidatePaths
    .filter((file) => !selected.has(file) && isSafeReadableFile(root, file))
    .map((file) => scoreCandidate({
      file,
      explicitPathSet,
      changedPathSet,
      recentPathSet,
      importNeighborSet,
      mentionedBasenames,
      keywords,
    }))
    .filter((file) => file.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  for (const file of scored) {
    if (selected.size >= MAX_SELECTED_FILES) break;
    selected.set(file.path, { path: file.path, reasons: file.reasons });
  }

  return Array.from(selected.values()).slice(0, MAX_SELECTED_FILES);
}

function repoMapBlock(entries: RepoMapEntry[]): string | undefined {
  if (entries.length === 0) return undefined;
  const suffix =
    entries.length >= MAX_REPO_MAP_ENTRIES
      ? `\n...repo map capped at ${MAX_REPO_MAP_ENTRIES} entries`
      : "";
  return [
    "Repo map:",
    ...entries.map((entry) => `- ${entry.path}`),
  ].join("\n") + suffix;
}

function gitBlock(git: GitSummary): string {
  const lines = ["Recent git context:"];
  if (git.branch) lines.push(`- Branch: ${git.branch}`);
  if (git.statusLines.length > 0) {
    lines.push("- Status:");
    lines.push(...git.statusLines.slice(0, 30).map((line) => `  ${line}`));
    if (git.statusLines.length > 30) {
      lines.push(`  ...${git.statusLines.length - 30} more status lines`);
    }
  } else {
    lines.push("- Status: clean");
  }
  if (git.diffStat) lines.push(`- Diff stat: ${compactLine(git.diffStat, 700)}`);
  if (git.stagedDiffStat) {
    lines.push(`- Staged diff stat: ${compactLine(git.stagedDiffStat, 700)}`);
  }
  return lines.join("\n");
}

function selectedFilesBlock(root: string, files: SelectedFile[]): string | undefined {
  const summaries = files.flatMap((file): string[] => {
    const summary = summarizeFile(root, file.path);
    if (!summary) return [];
    const reasons = file.reasons.length > 0
      ? ` [${file.reasons.join(", ")}]`
      : "";
    return [`- ${file.path}${reasons}: ${summary}`];
  });
  if (summaries.length === 0) return undefined;
  return ["Selected file summaries:", ...summaries].join("\n");
}

function summarizeFile(root: string, relativePath: string): string | undefined {
  const absolutePath = path.join(root, relativePath);
  const content = safeReadText(absolutePath);
  if (!content) return undefined;

  const extension = path.extname(relativePath).toLowerCase();
  if (relativePath === "package.json") {
    const packageSummary = summarizePackageJson(content);
    return packageSummary || undefined;
  }
  if (extension === ".md") {
    const headings = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^#{1,3}\s+\S/.test(line))
      .slice(0, 8);
    const summary = headings.length > 0
      ? `headings: ${headings.join("; ")}`
      : firstUsefulLines(content);
    return compactLine(summary, MAX_FILE_SUMMARY_CHARS);
  }

  return compactLine(firstUsefulLines(content), MAX_FILE_SUMMARY_CHARS);
}

function summarizePackageJson(content: string): string | undefined {
  const parsed = parseJsonObject(content);
  if (!parsed) return undefined;
  const scripts = isRecord(parsed.scripts)
    ? Object.keys(parsed.scripts).sort((left, right) => left.localeCompare(right))
    : [];
  const dependencies = [
    ...packageSectionNames(parsed.dependencies),
    ...packageSectionNames(parsed.devDependencies),
  ];
  const packageManager =
    typeof parsed.packageManager === "string" ? parsed.packageManager : undefined;
  return compactLine(
    [
      packageManager ? `packageManager ${packageManager}` : undefined,
      scripts.length > 0 ? `scripts ${scripts.slice(0, 20).join(", ")}` : undefined,
      dependencies.length > 0
        ? `deps ${Array.from(new Set(dependencies)).slice(0, 30).join(", ")}`
        : undefined,
    ]
      .filter((part): part is string => Boolean(part))
      .join("; "),
    MAX_FILE_SUMMARY_CHARS,
  );
}

function gitSummary(root: string): GitSummary | undefined {
  const inside = runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") return undefined;

  const branch = runGit(root, ["branch", "--show-current"]);
  const status = runGit(root, ["status", "--short"]);
  const diff = runGit(root, ["diff", "--stat", "--", "."]);
  const stagedDiff = runGit(root, ["diff", "--cached", "--stat", "--", "."]);

  return {
    ...(branch.ok && branch.stdout.trim() ? { branch: branch.stdout.trim() } : {}),
    statusLines: status.ok
      ? status.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean)
      : [],
    ...(diff.ok && diff.stdout.trim()
      ? { diffStat: compactLine(diff.stdout, 1_000) }
      : {}),
    ...(stagedDiff.ok && stagedDiff.stdout.trim()
      ? { stagedDiffStat: compactLine(stagedDiff.stdout, 1_000) }
      : {}),
  };
}

function runGit(
  cwd: string,
  args: readonly string[],
): { ok: true; stdout: string } | { ok: false; stdout: string; error: string } {
  try {
    return {
      ok: true,
      stdout: execFileSync("git", [...args], {
        cwd,
        env: buildBashEnvironment() as NodeJS.ProcessEnv,
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
      }),
    };
  } catch (err) {
    return {
      ok: false,
      stdout: outputText(err, "stdout"),
      error: outputText(err, "stderr") || errorMessage(err),
    };
  }
}

function explicitRequestPaths(text: string): string[] {
  const paths = [
    ...Array.from(text.matchAll(/`([^`]+)`/g), (match) => match[1]),
    ...Array.from(
      text.matchAll(
        /(^|[\s("'`])((?:\.{1,2}[\\/])?(?:(?:[\w@+.-]+[\\/])+)?[\w@+.-]+\.(?:css|js|jsx|json|md|mjs|mts|ts|tsx))(?=$|[\s)"'`,:;!?])/gi,
      ),
      (match) => match[2],
    ),
  ];
  return normalizeSignalPaths(paths);
}

function keywordsFor(text: string): string[] {
  const stopWords = new Set([
    "add",
    "and",
    "can",
    "for",
    "from",
    "implement",
    "item",
    "items",
    "next",
    "please",
    "roadmap",
    "the",
    "this",
    "with",
    "work",
  ]);
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !stopWords.has(word));
  return Array.from(new Set(words)).slice(0, 25);
}

function scorePath(relativePath: string, keywords: readonly string[]): number {
  const normalized = relativePath.toLowerCase();
  return keywords.reduce((score, keyword) => {
    if (normalized === keyword) return score + 10;
    if (normalized.includes(keyword)) return score + 3;
    return score;
  }, 0);
}

function scoreCandidate({
  file,
  explicitPathSet,
  changedPathSet,
  recentPathSet,
  importNeighborSet,
  mentionedBasenames,
  keywords,
}: {
  file: string;
  explicitPathSet: ReadonlySet<string>;
  changedPathSet: ReadonlySet<string>;
  recentPathSet: ReadonlySet<string>;
  importNeighborSet: ReadonlySet<string>;
  mentionedBasenames: ReadonlySet<string>;
  keywords: readonly string[];
}): SelectedFile & { score: number } {
  let score = 0;
  const reasons: SelectedReason[] = [];

  if (explicitPathSet.has(file)) {
    score += 1_000;
    reasons.push("path-mention");
  }
  if (mentionedBasenames.has(path.basename(file).toLowerCase())) {
    score += 900;
    reasons.push("basename-mention");
  }
  if (changedPathSet.has(file)) {
    score += 700;
    reasons.push("git-changed");
  }
  if (recentPathSet.has(file)) {
    score += 600;
    reasons.push("recent");
  }
  if (importNeighborSet.has(file)) {
    score += 500;
    reasons.push("import-neighbor");
  }

  const keywordScore = scorePath(file, keywords);
  if (keywordScore > 0) {
    score += keywordScore;
    reasons.push("keyword");
  }

  return { path: file, reasons, score };
}

function changedPathsFromStatusLines(statusLines: readonly string[]): string[] {
  const paths: string[] = [];
  for (const line of statusLines) {
    if (line.length < 4) continue;
    const rawPath = line.slice(3).trim();
    if (!rawPath) continue;
    if (rawPath.includes(" -> ")) {
      const [source, target] = rawPath.split(" -> ", 2);
      paths.push(source, target);
      continue;
    }
    paths.push(rawPath);
  }
  return normalizeSignalPaths(paths);
}

function mentionedBasenameSet(text: string): Set<string> {
  return new Set(
    explicitRequestPaths(text).map((file) => path.basename(file).toLowerCase()),
  );
}

function importNeighborCandidates(
  root: string,
  seedPaths: readonly string[],
): string[] {
  const neighbors: string[] = [];
  const seen = new Set<string>();

  for (const seedPath of seedPaths) {
    if (neighbors.length >= MAX_IMPORT_NEIGHBOR_CANDIDATES) break;
    if (!isJsTsPath(seedPath) || !isSafeReadableFile(root, seedPath)) continue;
    const content = safeReadText(path.join(root, seedPath));
    if (!content) continue;

    for (const specifier of relativeImportSpecifiers(content)) {
      if (neighbors.length >= MAX_IMPORT_NEIGHBOR_CANDIDATES) break;
      const resolved = resolveRelativeImport(root, seedPath, specifier);
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      neighbors.push(resolved);
    }
  }

  return neighbors;
}

function relativeImportSpecifiers(content: string): string[] {
  const pattern =
    /(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;
  const specifiers: string[] = [];
  for (const match of content.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? "";
    if (specifier.startsWith(".")) specifiers.push(specifier);
  }
  return uniqueStrings(specifiers);
}

function resolveRelativeImport(
  root: string,
  importerPath: string,
  specifier: string,
): string | undefined {
  const basePath = normalizeRelative(path.join(path.dirname(importerPath), specifier));
  const candidates = importResolutionCandidates(basePath);
  return candidates.find((candidate) => isSafeReadableFile(root, candidate));
}

function importResolutionCandidates(basePath: string): string[] {
  const extension = path.extname(basePath).toLowerCase();
  if (JS_TS_EXTENSIONS.includes(extension)) return [basePath];
  return [
    ...JS_TS_EXTENSIONS.map((candidateExtension) => `${basePath}${candidateExtension}`),
    ...JS_TS_EXTENSIONS.map((candidateExtension) =>
      normalizeRelative(path.join(basePath, `index${candidateExtension}`)),
    ),
  ];
}

function isJsTsPath(relativePath: string): boolean {
  return JS_TS_EXTENSIONS.includes(path.extname(relativePath).toLowerCase());
}

function normalizeSignalPaths(values: readonly string[]): string[] {
  return uniqueStrings(values.flatMap((value): string[] => {
    const normalized = normalizeSignalPath(value);
    return normalized ? [normalized] : [];
  }));
}

function normalizeSignalPath(value: string): string | undefined {
  const withoutLineSuffix = value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/:\d+(?::\d+)?$/, "");
  const normalized = normalizeRelative(withoutLineSuffix);
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return undefined;
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return undefined;
  }
  const relativePath = parts.join("/");
  return isSummarizablePath(relativePath) ? relativePath : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function isSafeReadableFile(root: string, relativePath: string): boolean {
  const normalized = normalizeRelative(relativePath);
  if (!isSummarizablePath(normalized) || shouldSkipPath(normalized)) return false;
  const absolutePath = path.resolve(root, normalized);
  if (!isInside(absolutePath, root)) return false;
  try {
    const stat = fs.lstatSync(absolutePath);
    return stat.isFile() && stat.size <= 250_000;
  } catch {
    return false;
  }
}

function isSummarizablePath(relativePath: string): boolean {
  const basename = path.basename(relativePath).toLowerCase();
  if (
    basename.startsWith(".env") ||
    basename.includes("secret") ||
    basename.includes("token") ||
    basename.includes("key")
  ) {
    return false;
  }
  if (SKIPPED_FILES.has(basename)) return false;
  return SUMMARIZABLE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function shouldSkipPath(value: string): boolean {
  const parts = normalizeRelative(value)
    .split("/")
    .map((part) => part.toLowerCase());
  return parts.some((part) => SKIPPED_DIRECTORIES.has(part) || SKIPPED_FILES.has(part));
}

function safeReadDir(absolutePath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(absolutePath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeReadText(absolutePath: string): string | undefined {
  try {
    const content = fs.readFileSync(absolutePath, "utf8").slice(0, MAX_FILE_READ_CHARS);
    return redactText(content);
  } catch {
    return undefined;
  }
}

function firstUsefulLines(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("/*"))
    .slice(0, 8)
    .join(" ");
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function packageSectionNames(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return Object.keys(value).sort((left, right) => left.localeCompare(right));
}

function compareDirents(left: fs.Dirent, right: fs.Dirent): number {
  if (left.isDirectory() !== right.isDirectory()) {
    return left.isDirectory() ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

function compactLine(value: string, maxLength: number): string {
  return compactBlock(value.replace(/\s+/g, " "), maxLength);
}

function compactBlock(value: string, maxLength: number): string {
  const compacted = redactText(value).replace(/\r\n/g, "\n").trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function outputText(err: unknown, key: "stdout" | "stderr"): string {
  if (typeof err !== "object" || err === null || !(key in err)) return "";
  const value = (err as Record<typeof key, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
