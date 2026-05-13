import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";

import { buildBashEnvironment } from "../command-policy";
import {
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
} from "../sandbox";
import {
  dependencyNames,
  detectPackageManager,
  readPackageJson,
  scriptNames,
} from "./package-manager";

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

export function createInspectProjectTool(workspaceRoot?: string) {
  return tool({
    description:
      "Inspect the active project before coding. Summarizes package manager, scripts, key dependencies, noteworthy files, and git state without modifying files.",
    inputSchema: z.object({}),
    execute: async () => {
      const root = workspaceRoot
        ? ensureWorkspaceRootAt(workspaceRoot)
        : ensureWorkspaceRoot();
      const packageJson = readPackageJson(root);
      const git = gitInfo(root);

      if (!packageJson.ok) {
        return {
          ok: true as const,
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
        ok: true as const,
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
    },
  });
}

export const inspectProjectTool = createInspectProjectTool();

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

function gitInfo(root: string): {
  isRepository: boolean;
  branch: string | null;
  dirtyFileCount: number;
  dirtyFiles: string[];
  error?: string;
} {
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
  const status = runGit(root, ["status", "--short"]);
  const dirtyFiles = status.ok
    ? status.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];

  return {
    isRepository: true,
    branch: branch.ok ? branch.stdout.trim() || null : null,
    dirtyFileCount: status.ok
      ? status.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0).length
      : 0,
    dirtyFiles,
    ...(status.ok ? {} : { error: status.error }),
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

function outputText(err: unknown, key: "stdout" | "stderr"): string {
  if (typeof err !== "object" || err === null || !(key in err)) return "";
  const value = (err as Record<typeof key, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
