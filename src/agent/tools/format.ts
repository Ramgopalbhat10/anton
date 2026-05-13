import path from "node:path";
import { z } from "zod";
import { tool } from "ai";

import {
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
  resolveInWorkspace,
  SandboxError,
} from "../sandbox";
import {
  assertPathGuardAllowed,
  normalizeRelPath,
} from "./file-guardrails";
import { runWorkspaceProcess } from "./process";
import {
  detectPackageManager,
  execCommand,
  hasDependency,
  readPackageJson,
  runScriptCommand,
  type PackageManager,
} from "./package-manager";

export type FormatCommandPlan =
  | {
      ok: true;
      packageManager: PackageManager;
      command: string[];
      paths: string[];
      reason: string;
    }
  | { ok: false; error: string };

const formatInputSchema = z.object({
  paths: z
    .array(z.string())
    .optional()
    .describe("Files or directories to format, relative to the workspace root. Defaults to the formatter script target."),
  allowGuarded: z
    .boolean()
    .optional()
    .describe("Set true only when intentionally formatting guarded targets such as lockfiles, migrations, generated files, binary files, or large files."),
});

export function createFormatTool(workspaceRoot?: string) {
  return tool({
    description:
      "Format workspace files using the active repository's package manager and formatter script. Prefers package.json format scripts, then formatter dependencies. Requires approval.",
    inputSchema: formatInputSchema,
    execute: async ({ paths = [], allowGuarded = false }) => {
      try {
        const root = workspaceRoot
          ? ensureWorkspaceRootAt(workspaceRoot)
          : ensureWorkspaceRoot();
        const normalizedPaths = validateFormatPaths(paths, root, allowGuarded);
        const plan = planFormatCommand(root, { paths: normalizedPaths });
        if (!plan.ok) return plan;
        const [file, ...args] = plan.command;
        if (!file) return { ok: false as const, error: "formatter command is empty" };
        const result = await runWorkspaceProcess(file, args, root);
        return {
          ok: result.exitCode === 0,
          packageManager: plan.packageManager,
          command: plan.command.join(" "),
          paths: plan.paths,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          ...(result.exitCode === 0
            ? {}
            : { error: result.stderr || result.stdout || "formatter command failed" }),
        };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export const formatTool = createFormatTool();

export function planFormatCommand(
  workspaceRoot: string | undefined,
  input: { paths?: readonly string[] },
): FormatCommandPlan {
  const root = workspaceRoot ? path.resolve(workspaceRoot) : process.cwd();
  const packageJson = readPackageJson(root);
  if (!packageJson.ok) return packageJson;

  const packageManager = detectPackageManager(root, packageJson.value);
  const paths = [...(input.paths ?? [])];
  const scripts = packageJson.value.scripts ?? {};
  if (typeof scripts.format === "string") {
    return {
      ok: true,
      packageManager,
      command: runScriptCommand(packageManager, "format", paths),
      paths,
      reason: "package.json format script",
    };
  }

  if (hasDependency(packageJson.value, "prettier")) {
    return {
      ok: true,
      packageManager,
      command: execCommand(packageManager, ["prettier", "--write", ...(paths.length ? paths : ["."])]),
      paths: paths.length ? paths : ["."],
      reason: "prettier dependency",
    };
  }

  if (hasDependency(packageJson.value, "@biomejs/biome")) {
    return {
      ok: true,
      packageManager,
      command: execCommand(packageManager, ["biome", "format", "--write", ...(paths.length ? paths : ["."])]),
      paths: paths.length ? paths : ["."],
      reason: "Biome formatter dependency",
    };
  }

  return {
    ok: false,
    error: "No package.json format script or supported formatter dependency was found.",
  };
}

function validateFormatPaths(
  paths: readonly string[],
  workspaceRoot: string | undefined,
  allowGuarded: boolean,
): string[] {
  return paths.map((relPath) => {
    resolveInWorkspace(relPath, workspaceRoot);
    assertPathGuardAllowed({ relPath, allowGuarded });
    const normalized = normalizeInputPath(relPath);
    if (normalized === ".") {
      throw new Error("format paths must name a file or directory, not the workspace root marker");
    }
    return normalized;
  });
}

function normalizeInputPath(relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  return normalized === "" ? "." : normalized;
}

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
