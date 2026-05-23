import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { buildBashEnvironment } from "@/src/agent/command-policy";
import {
  dependencyNames,
  detectPackageManager,
  readPackageJson,
  scriptNames,
} from "@/src/agent/tools/package-manager";

const NOTEWORTHY_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "ROADMAP.md",
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "vite.config.ts",
  "drizzle.config.ts",
  ".mcp.json",
] as const;

const MAX_DIRTY_FILES = 50;

export type ProjectInspectGitInfo = {
  isRepository: boolean;
  branch: string | null;
  dirtyFileCount: number;
  dirtyFiles: string[];
  error?: string;
};

export type ProjectInspectResult = {
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | null;
  scripts: string[];
  keyDependencies: string[];
  noteworthyFiles: string[];
  git: ProjectInspectGitInfo;
  summary: string;
};

export function inspectProjectAtPath(root: string): ProjectInspectResult {
  const packageJson = readPackageJson(root);
  const git = gitInfo(root);

  if (!packageJson.ok) {
    return {
      packageManager: null,
      scripts: [],
      keyDependencies: [],
      noteworthyFiles: existingNoteworthyFiles(root),
      git,
      summary: "No package.json found; inspect files manually before coding.",
    };
  }

  const dependencies = dependencyNames(packageJson.value);
  const keyDependencies = dependencies.filter(isKeyDependency).slice(0, 30);
  const scripts = scriptNames(packageJson.value);
  const packageManager = detectPackageManager(root, packageJson.value);

  return {
    packageManager,
    scripts,
    keyDependencies,
    noteworthyFiles: existingNoteworthyFiles(root),
    git,
    summary: [
      `${packageManager} project`,
      scripts.length ? `scripts: ${scripts.join(", ")}` : "no scripts",
      keyDependencies.length
        ? `key deps: ${keyDependencies.join(", ")}`
        : "no key deps detected",
      git.branch ? `git branch: ${git.branch}` : "git branch unavailable",
      git.dirtyFileCount > 0
        ? `${git.dirtyFileCount} dirty file${git.dirtyFileCount === 1 ? "" : "s"}`
        : "working tree clean",
    ].join("; "),
  };
}

function existingNoteworthyFiles(root: string): string[] {
  return NOTEWORTHY_FILES.filter((file) => fs.existsSync(path.join(root, file)));
}

function isKeyDependency(name: string): boolean {
  return [
    "@ai-sdk/react",
    "@openrouter/ai-sdk-provider",
    "ai",
    "better-sqlite3",
    "drizzle-orm",
    "eslint",
    "next",
    "react",
    "tailwindcss",
    "typescript",
    "vite",
    "zod",
  ].includes(name);
}

function gitInfo(root: string): ProjectInspectGitInfo {
  const inside = runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) {
    return {
      isRepository: false,
      branch: null,
      dirtyFileCount: 0,
      dirtyFiles: [],
      error: inside.error,
    };
  }
  if (inside.stdout.trim() !== "true") {
    return {
      isRepository: false,
      branch: null,
      dirtyFileCount: 0,
      dirtyFiles: [],
    };
  }

  const branch = runGit(root, ["branch", "--show-current"]);
  const status = runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const dirtyFiles = status.ok
    ? parseDirtyFilesFromPorcelain(status.stdout).slice(0, MAX_DIRTY_FILES)
    : [];

  return {
    isRepository: true,
    branch: branch.ok ? branch.stdout.trim() || null : null,
    dirtyFileCount: status.ok
      ? parseDirtyFilesFromPorcelain(status.stdout).length
      : 0,
    dirtyFiles,
    ...(status.ok ? {} : { error: status.error }),
  };
}

export function parseDirtyFilesFromPorcelain(output: string): string[] {
  if (!output.trim()) return [];
  const entries = output.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    if (entry.length < 3) {
      const trimmed = entry.trim();
      if (trimmed) paths.push(trimmed);
      continue;
    }
    const marker = entry.slice(0, 2);
    const rest = entry.slice(3).trim();
    if (marker === "R " || marker === "C ") {
      const renamedPath = entries[index + 1]?.trim();
      if (renamedPath) {
        paths.push(renamedPath);
        index += 1;
      } else if (rest) {
        paths.push(rest);
      }
      continue;
    }
    if (rest) paths.push(rest);
  }
  return paths;
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

function outputText(err: unknown, key: "stdout" | "stderr"): string {
  if (typeof err !== "object" || err === null || !(key in err)) return "";
  const value = (err as Record<typeof key, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
