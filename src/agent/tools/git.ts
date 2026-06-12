import { createHash } from "node:crypto";
import { z } from "zod";
import { tool } from "ai";

import { ensureWorkspaceRoot, ensureWorkspaceRootAt, resolveInWorkspace, SandboxError } from "../sandbox";
import { assertPathGuardAllowed, normalizeRelPath } from "./file-guardrails";
import { runWorkspaceProcess } from "@/src/workspace/process-runner";

const pathListSchema = z
  .array(z.string())
  .min(1)
  .describe("One or more files or directories relative to the workspace root.");

const optionalPathListSchema = z
  .array(z.string())
  .optional()
  .describe("Optional file or directory scope, relative to the workspace root.");

export function createGitStatusTool(workspaceRoot?: string) {
  return tool({
    description:
      "Show git status for the workspace repository using porcelain output. Read-only.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const root = workspace(workspaceRoot);
        const result = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
        if (result.exitCode !== 0) return gitError(result);
        return { ok: true as const, entries: parseStatus(result.stdout) };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export function createGitDiffTool(workspaceRoot?: string) {
  return tool({
    description:
      "Show a scoped git diff and return a SHA-256 hash of the patch for later revert confirmation. Read-only.",
    inputSchema: z.object({
      paths: optionalPathListSchema,
      staged: z.boolean().optional().describe("Show staged changes with --cached."),
    }),
    execute: async ({ paths = [], staged = false }) => {
      try {
        const root = workspace(workspaceRoot);
        const scopedPaths = validatePaths(paths, root, true);
        const args = ["diff", ...(staged ? ["--cached"] : []), ...pathspecArgs(scopedPaths)];
        const result = await git(root, args);
        if (result.exitCode !== 0) return gitError(result);
        return {
          ok: true as const,
          staged,
          paths: scopedPaths,
          patch: result.stdout,
          diffHash: sha256(result.stdout),
        };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export function createGitShowTool(workspaceRoot?: string) {
  return tool({
    description:
      "Show one git revision, optionally with --stat. Read-only.",
    inputSchema: z.object({
      ref: z.string().optional().describe("Revision to inspect. Defaults to HEAD."),
      stat: z.boolean().optional().describe("Use --stat instead of a full patch."),
    }),
    execute: async ({ ref = "HEAD", stat = false }) => {
      try {
        assertSafeGitRef(ref);
        const root = workspace(workspaceRoot);
        const result = await git(root, ["show", ...(stat ? ["--stat"] : []), ref]);
        if (result.exitCode !== 0) return gitError(result);
        return { ok: true as const, ref, output: result.stdout };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

const branchInputSchema = z
  .object({
    action: z
      .enum(["current", "list", "create", "switch"])
      .describe("Branch operation to perform."),
    name: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Branch name. Required for create and switch."),
    startPoint: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional git start point for create."),
    switch: z
      .boolean()
      .optional()
      .describe("For create, switch to the new branch. Defaults to true."),
  })
  .superRefine((input, ctx) => {
    if (
      (input.action === "create" || input.action === "switch") &&
      !input.name
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "name is required for create and switch",
      });
    }
    if (input.action !== "create" && input.startPoint) {
      ctx.addIssue({
        code: "custom",
        path: ["startPoint"],
        message: "startPoint is only supported for create",
      });
    }
    if (input.action !== "create" && input.switch !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["switch"],
        message: "switch is only supported for create",
      });
    }
  });

export function createGitBranchTool(workspaceRoot?: string) {
  return tool({
    description:
      "Inspect, create, or switch git branches. New branch names default to the codex/ prefix when no prefix is supplied.",
    inputSchema: branchInputSchema,
    execute: async (input) => {
      try {
        const root = workspace(workspaceRoot);
        if (input.action === "current") {
          const result = await git(root, ["branch", "--show-current"]);
          if (result.exitCode !== 0) return gitError(result);
          return { ok: true as const, branch: result.stdout.trim() };
        }
        if (input.action === "list") {
          const result = await git(root, ["branch", "--format=%(refname:short)"]);
          if (result.exitCode !== 0) return gitError(result);
          return {
            ok: true as const,
            branches: result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          };
        }
        if (!input.name) {
          throw new Error("branch name is required for create and switch");
        }
        const branch = normalizeBranchName(input.name);
        await assertValidBranchName(root, branch);
        if (input.action === "switch") {
          const result = await git(root, ["switch", branch]);
          if (result.exitCode !== 0) return gitError(result);
          return { ok: true as const, branch, current: true };
        }
        if (input.startPoint) assertSafeGitRef(input.startPoint);
        const args = input.switch === false
          ? ["branch", branch, ...(input.startPoint ? [input.startPoint] : [])]
          : ["switch", "-c", branch, ...(input.startPoint ? [input.startPoint] : [])];
        const result = await git(root, args);
        if (result.exitCode !== 0) return gitError(result);
        return { ok: true as const, branch, current: input.switch !== false };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export function createGitCommitTool(workspaceRoot?: string) {
  return tool({
    description:
      "Stage explicit workspace paths and create a git commit with the provided message. Requires approval.",
    inputSchema: z.object({
      message: z.string().min(1).describe("Commit message."),
      paths: pathListSchema,
      allowGuarded: z.boolean().optional().describe("Allow committing guarded path scopes intentionally."),
    }),
    execute: async ({ message, paths, allowGuarded = false }) => {
      try {
        const root = workspace(workspaceRoot);
        const scopedPaths = validatePaths(paths, root, allowGuarded);
        const add = await git(root, ["add", "--", ...scopedPaths]);
        if (add.exitCode !== 0) return gitError(add);
        const commit = await git(root, ["commit", "-m", message]);
        if (commit.exitCode !== 0) return gitError(commit);
        const rev = await git(root, ["rev-parse", "HEAD"]);
        if (rev.exitCode !== 0) return gitError(rev);
        return {
          ok: true as const,
          commit: rev.stdout.trim(),
          committedPaths: scopedPaths,
          stdout: commit.stdout,
          stderr: commit.stderr,
        };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export function createGitRestoreTool(workspaceRoot?: string) {
  return tool({
    description:
      "Restore explicit tracked paths in the working tree or index using git restore. Requires approval.",
    inputSchema: z.object({
      paths: pathListSchema,
      staged: z.boolean().optional().describe("Restore staged/index state."),
      worktree: z.boolean().optional().describe("Restore working tree state. Defaults to true."),
      allowGuarded: z.boolean().optional().describe("Allow restoring guarded path scopes intentionally."),
    }),
    execute: async ({ paths, staged = false, worktree = true, allowGuarded = false }) => {
      try {
        if (!staged && !worktree) {
          throw new Error("git_restore requires staged or worktree restoration");
        }
        const root = workspace(workspaceRoot);
        const scopedPaths = validatePaths(paths, root, allowGuarded);
        const modeArgs = staged ? (worktree ? ["--staged", "--worktree"] : ["--staged"]) : [];
        const result = await git(root, ["restore", ...modeArgs, "--", ...scopedPaths]);
        if (result.exitCode !== 0) return gitError(result);
        return { ok: true as const, restoredPaths: scopedPaths, staged, worktree };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export function createRevertChangesTool(workspaceRoot?: string) {
  return tool({
    description:
      "Revert scoped working-tree changes only when the current git diff hash matches the expected hash from git_diff. Requires approval.",
    inputSchema: z.object({
      paths: pathListSchema,
      expectedDiffHash: z.string().min(1).describe("SHA-256 diffHash returned by git_diff for the same path scope."),
      allowGuarded: z.boolean().optional().describe("Allow reverting guarded path scopes intentionally."),
    }),
    execute: async ({ paths, expectedDiffHash, allowGuarded = false }) => {
      try {
        const root = workspace(workspaceRoot);
        const scopedPaths = validatePaths(paths, root, allowGuarded);
        const diff = await git(root, ["diff", ...pathspecArgs(scopedPaths)]);
        if (diff.exitCode !== 0) return gitError(diff);
        const actualHash = sha256(diff.stdout);
        if (actualHash !== expectedDiffHash) {
          return {
            ok: false as const,
            error: `diff hash mismatch: expected ${expectedDiffHash}, found ${actualHash}`,
            actualDiffHash: actualHash,
          };
        }
        const restore = await git(root, ["restore", "--", ...scopedPaths]);
        if (restore.exitCode !== 0) return gitError(restore);
        return { ok: true as const, restoredPaths: scopedPaths, diffHash: actualHash };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export const gitStatusTool = createGitStatusTool();
export const gitDiffTool = createGitDiffTool();
export const gitShowTool = createGitShowTool();
export const gitBranchTool = createGitBranchTool();
export const gitCommitTool = createGitCommitTool();
export const gitRestoreTool = createGitRestoreTool();
export const revertChangesTool = createRevertChangesTool();

function workspace(workspaceRoot: string | undefined): string {
  return workspaceRoot ? ensureWorkspaceRootAt(workspaceRoot) : ensureWorkspaceRoot();
}

async function git(root: string, args: readonly string[]) {
  return await runWorkspaceProcess("git", args, root);
}

function validatePaths(
  paths: readonly string[],
  root: string,
  allowGuarded: boolean,
): string[] {
  return paths.map((relPath) => {
    resolveInWorkspace(relPath, root);
    assertPathGuardAllowed({ relPath, allowGuarded });
    const normalized = normalizeRelPath(relPath);
    if (!normalized || normalized === ".") {
      throw new Error("git path scopes must name a file or directory");
    }
    return normalized;
  });
}

function pathspecArgs(paths: readonly string[]): string[] {
  return paths.length > 0 ? ["--", ...paths] : [];
}

function parseStatus(output: string): Array<{
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}> {
  const tokens = output.split("\0").filter(Boolean);
  const entries: Array<{ path: string; indexStatus: string; worktreeStatus: string }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.length < 4) continue;
    const indexStatus = token[0] ?? " ";
    const worktreeStatus = token[1] ?? " ";
    const statusPath = token.slice(3);
    if (indexStatus === "R" || indexStatus === "C") index += 1;
    entries.push({
      path: normalizeRelPath(statusPath),
      indexStatus,
      worktreeStatus,
    });
  }
  return entries;
}

function normalizeBranchName(name: string): string {
  return name.includes("/") ? name : `codex/${name}`;
}

async function assertValidBranchName(root: string, branch: string): Promise<void> {
  if (branch.startsWith("-") || /[\s\0-\x1f]/.test(branch)) {
    throw new Error(`invalid branch name: ${branch}`);
  }
  const result = await git(root, ["check-ref-format", "--branch", branch]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `invalid branch name: ${branch}`);
  }
}

function assertSafeGitRef(ref: string): void {
  if (ref.startsWith("-") || /[\s\0-\x1f]/.test(ref)) {
    throw new Error(`invalid git ref: ${ref}`);
  }
}

function gitError(result: { stderr: string; stdout: string; exitCode: number | null }) {
  return {
    ok: false as const,
    exitCode: result.exitCode ?? 1,
    error: result.stderr || result.stdout || "git command failed",
  };
}

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
