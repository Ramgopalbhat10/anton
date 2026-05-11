import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildToolApprovalMetadata } from "../src/agent/permissions";
import {
  createGitBranchTool,
  createGitCommitTool,
  createGitDiffTool,
  createGitRestoreTool,
  createGitShowTool,
  createGitStatusTool,
  createRevertChangesTool,
} from "../src/agent/tools/git";

type ToolLike<TInput, TOutput> = {
  execute: (input: TInput, options?: unknown) => Promise<TOutput> | TOutput;
};

const execFileAsync = promisify(execFile);

test("git status, diff, and revert_changes use a scoped diff hash", async () => {
  const root = await gitRoot();
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const value = 2;\n", "utf8");

  const status = await runTool<
    Record<string, never>,
    { ok: true; entries: Array<{ path: string; indexStatus: string; worktreeStatus: string }> }
  >(createGitStatusTool(root), {});
  assert.equal(status.ok, true);
  assert.deepEqual(status.entries, [
    { path: "src/index.ts", indexStatus: " ", worktreeStatus: "M" },
  ]);

  const diff = await runTool<
    { paths: string[] },
    { ok: true; patch: string; diffHash: string }
  >(createGitDiffTool(root), { paths: ["src/index.ts"] });
  assert.equal(diff.ok, true);
  assert.match(diff.patch, /value = 2/);
  assert.equal(diff.diffHash, sha256(diff.patch));

  const staleRevert = await runTool<
    { paths: string[]; expectedDiffHash: string },
    { ok: false; error: string }
  >(createRevertChangesTool(root), {
    paths: ["src/index.ts"],
    expectedDiffHash: "stale",
  });
  assert.equal(staleRevert.ok, false);
  assert.match(staleRevert.error, /diff hash/i);

  const revert = await runTool<
    { paths: string[]; expectedDiffHash: string },
    { ok: true; restoredPaths: string[] }
  >(createRevertChangesTool(root), {
    paths: ["src/index.ts"],
    expectedDiffHash: diff.diffHash,
  });
  assert.equal(revert.ok, true);
  assert.deepEqual(revert.restoredPaths, ["src/index.ts"]);
  assert.equal(
    readNormalized(path.join(root, "src", "index.ts")),
    "export const value = 1;\n",
  );
});

test("git branch, restore, commit, and show operate on explicit scopes", async () => {
  const root = await gitRoot();

  const created = await runTool<
    { action: "create"; name: string },
    { ok: true; branch: string; current: boolean }
  >(createGitBranchTool(root), { action: "create", name: "57-workflow-tools" });
  assert.equal(created.ok, true);
  assert.equal(created.branch, "codex/57-workflow-tools");
  assert.equal(created.current, true);

  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const value = 3;\n", "utf8");
  const restore = await runTool<
    { paths: string[] },
    { ok: true; restoredPaths: string[] }
  >(createGitRestoreTool(root), { paths: ["src/index.ts"] });
  assert.equal(restore.ok, true);
  assert.deepEqual(restore.restoredPaths, ["src/index.ts"]);
  assert.equal(
    readNormalized(path.join(root, "src", "index.ts")),
    "export const value = 1;\n",
  );

  const invalidRestore = await runTool<
    { paths: string[]; worktree: boolean },
    { ok: false; error: string }
  >(createGitRestoreTool(root), { paths: ["src/index.ts"], worktree: false });
  assert.equal(invalidRestore.ok, false);
  assert.match(invalidRestore.error, /staged or worktree/i);

  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const value = 4;\n", "utf8");
  const commit = await runTool<
    { message: string; paths: string[] },
    { ok: true; commit: string; committedPaths: string[] }
  >(createGitCommitTool(root), {
    message: "test: update value",
    paths: ["src/index.ts"],
  });
  assert.equal(commit.ok, true);
  assert.deepEqual(commit.committedPaths, ["src/index.ts"]);
  assert.match(commit.commit, /^[0-9a-f]{40}$/);

  const show = await runTool<
    { ref: string; stat: boolean },
    { ok: true; output: string }
  >(createGitShowTool(root), { ref: "HEAD", stat: true });
  assert.equal(show.ok, true);
  assert.match(show.output, /test: update value/);
  assert.match(show.output, /src\/index\.ts/);
});

test("git approval metadata distinguishes read-only and mutating operations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anton-git-approval-"));

  const diffApproval = buildToolApprovalMetadata({
    toolName: "git_diff",
    workspaceRoot: root,
    input: { paths: ["src/index.ts"] },
  });
  assert.equal(diffApproval?.title, "Inspect git diff");
  assert.deepEqual(diffApproval?.riskCategories, ["read-only", "git"]);

  const commitApproval = buildToolApprovalMetadata({
    toolName: "git_commit",
    workspaceRoot: root,
    input: { message: "test: commit", paths: ["src/index.ts"] },
  });
  assert.equal(commitApproval?.title, "Create git commit");
  assert.deepEqual(commitApproval?.riskCategories, ["write", "git"]);
  assert.ok(commitApproval?.details.some((detail) => /src\/index\.ts/i.test(detail)));

  const revertApproval = buildToolApprovalMetadata({
    toolName: "revert_changes",
    workspaceRoot: root,
    input: { paths: ["src/index.ts"], expectedDiffHash: "abc123" },
  });
  assert.equal(revertApproval?.title, "Revert workspace changes");
  assert.deepEqual(revertApproval?.riskCategories, ["write", "delete", "git"]);
  assert.ok(revertApproval?.details.some((detail) => /diff hash/i.test(detail)));
});

async function runTool<TInput, TOutput>(
  tool: unknown,
  input: TInput,
): Promise<TOutput> {
  const executable = tool as ToolLike<TInput, TOutput>;
  return await executable.execute(input);
}

async function gitRoot(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anton-git-tools-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "anton@example.test"]);
  await git(root, ["config", "user.name", "Anton Tests"]);
  await git(root, ["add", "src/index.ts"]);
  await git(root, ["commit", "-m", "test: initial"]);
  return root;
}

async function git(root: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: root });
}

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function readNormalized(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}
