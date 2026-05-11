import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildToolApprovalMetadata } from "../src/agent/permissions";
import {
  createCopyTool,
  createDeleteTool,
  createMkdirTool,
  createReadDirTool,
  createRenameTool,
  createStatTool,
} from "../src/agent/tools/file-ops";
import { createEditFileTool } from "../src/agent/tools/edit-file";

type ToolLike<TInput, TOutput> = {
  execute: (input: TInput, options?: unknown) => Promise<TOutput> | TOutput;
};

type BasicOutput =
  | { ok: true; path?: string; targetPath?: string; destinationPath?: string }
  | { ok: false; error: string };

test("read_dir and stat return workspace file metadata", async () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export {}\n", "utf8");

  const listOutput = await runTool<{ path: string }, {
    ok: true;
    entries: Array<{ name: string; path: string; kind: string; sizeBytes: number }>;
  } | { ok: false; error: string }>(createReadDirTool(root), { path: "src" });

  assert.equal(listOutput.ok, true);
  assert.equal(listOutput.entries.length, 1);
  assert.equal(listOutput.entries[0]?.name, "index.ts");
  assert.equal(listOutput.entries[0]?.path, "src/index.ts");
  assert.equal(listOutput.entries[0]?.kind, "file");
  assert.equal(
    listOutput.entries[0]?.sizeBytes,
    Buffer.byteLength("export {}\n", "utf8"),
  );

  const statOutput = await runTool<{ path: string }, {
    ok: true;
    path: string;
    kind: string;
    sizeBytes: number;
    sha256?: string;
    guard: { guarded: boolean; reasons: string[] };
  } | { ok: false; error: string }>(createStatTool(root), { path: "src/index.ts" });

  assert.equal(statOutput.ok, true);
  assert.equal(statOutput.path, "src/index.ts");
  assert.equal(statOutput.kind, "file");
  assert.equal(statOutput.sha256, sha256("export {}\n"));
  assert.equal(statOutput.guard.guarded, false);
});

test("mkdir, copy, rename, and delete stay inside the workspace and require hashes for source files", async () => {
  const root = tempRoot();
  const sourceHash = sha256("alpha\n");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "alpha.txt"), "alpha\n", "utf8");

  const mkdirOutput = await runTool<{ path: string }, BasicOutput>(
    createMkdirTool(root),
    { path: "nested/output" },
  );
  assert.equal(mkdirOutput.ok, true);
  assert.equal(fs.statSync(path.join(root, "nested", "output")).isDirectory(), true);

  const copyWithoutHash = await runTool<
    { sourcePath: string; destinationPath: string },
    BasicOutput
  >(createCopyTool(root), {
    sourcePath: "src/alpha.txt",
    destinationPath: "nested/output/copy.txt",
  });
  assert.equal(copyWithoutHash.ok, false);
  assert.match(copyWithoutHash.error, /expectedSourceHash/i);

  const copyOutput = await runTool<
    { sourcePath: string; destinationPath: string; expectedSourceHash: string },
    BasicOutput
  >(createCopyTool(root), {
    sourcePath: "src/alpha.txt",
    destinationPath: "nested/output/copy.txt",
    expectedSourceHash: sourceHash,
  });
  assert.equal(copyOutput.ok, true);
  assert.equal(
    fs.readFileSync(path.join(root, "nested", "output", "copy.txt"), "utf8"),
    "alpha\n",
  );

  const renameOutput = await runTool<
    { sourcePath: string; destinationPath: string; expectedSourceHash: string },
    BasicOutput
  >(createRenameTool(root), {
    sourcePath: "nested/output/copy.txt",
    destinationPath: "nested/output/renamed.txt",
    expectedSourceHash: sourceHash,
  });
  assert.equal(renameOutput.ok, true);
  assert.equal(fs.existsSync(path.join(root, "nested", "output", "copy.txt")), false);
  assert.equal(
    fs.readFileSync(path.join(root, "nested", "output", "renamed.txt"), "utf8"),
    "alpha\n",
  );

  const deleteOutput = await runTool<
    { path: string; expectedHash: string },
    BasicOutput
  >(createDeleteTool(root), {
    path: "nested/output/renamed.txt",
    expectedHash: sourceHash,
  });
  assert.equal(deleteOutput.ok, true);
  assert.equal(fs.existsSync(path.join(root, "nested", "output", "renamed.txt")), false);

  const traversalOutput = await runTool<
    { sourcePath: string; destinationPath: string; expectedSourceHash: string },
    BasicOutput
  >(createCopyTool(root), {
    sourcePath: "src/alpha.txt",
    destinationPath: "../escape.txt",
    expectedSourceHash: sourceHash,
  });
  assert.equal(traversalOutput.ok, false);
  assert.match(traversalOutput.error, /escapes workspace|absolute paths/i);
});

test("mutating tools refuse guarded files unless explicitly allowed", async () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, "src", "db", "migrations"), { recursive: true });
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lock\n", "utf8");
  fs.writeFileSync(
    path.join(root, "src", "db", "migrations", "0001_init.sql"),
    "select 1;\n",
    "utf8",
  );

  const lockHash = sha256("lock\n");
  const editLock = await runTool<
    { path: string; patch: string; expectedHash: string },
    BasicOutput
  >(createEditFileTool(root), {
    path: "pnpm-lock.yaml",
    expectedHash: lockHash,
    patch: [
      "--- pnpm-lock.yaml",
      "+++ pnpm-lock.yaml",
      "@@ -1 +1 @@",
      "-lock",
      "+changed",
      "",
    ].join("\n"),
  });
  assert.equal(editLock.ok, false);
  assert.match(editLock.error, /guarded/i);

  const editAllowed = await runTool<
    { path: string; patch: string; expectedHash: string; allowGuarded: boolean },
    BasicOutput
  >(createEditFileTool(root), {
    path: "pnpm-lock.yaml",
    expectedHash: lockHash,
    allowGuarded: true,
    patch: [
      "--- pnpm-lock.yaml",
      "+++ pnpm-lock.yaml",
      "@@ -1 +1 @@",
      "-lock",
      "+changed",
      "",
    ].join("\n"),
  });
  assert.equal(editAllowed.ok, true);

  const deleteMigration = await runTool<
    { path: string; expectedHash: string },
    BasicOutput
  >(createDeleteTool(root), {
    path: "src/db/migrations/0001_init.sql",
    expectedHash: sha256("select 1;\n"),
  });
  assert.equal(deleteMigration.ok, false);
  assert.match(deleteMigration.error, /migration/i);
});

test("binary and large files are guarded for destructive file operations", async () => {
  const root = tempRoot();
  const binaryBytes = Buffer.from([0, 159, 146, 150]);
  const largeContent = "x".repeat(1024 * 1024 + 1);
  fs.writeFileSync(path.join(root, "image.bin"), binaryBytes);
  fs.writeFileSync(path.join(root, "large.txt"), largeContent, "utf8");

  const binaryStat = await runTool<{ path: string }, {
    ok: true;
    guard: { guarded: boolean; reasons: string[] };
  } | { ok: false; error: string }>(createStatTool(root), { path: "image.bin" });
  assert.equal(binaryStat.ok, true);
  assert.equal(binaryStat.guard.guarded, true);
  assert.ok(binaryStat.guard.reasons.some((reason) => /binary/i.test(reason)));

  const deleteLarge = await runTool<
    { path: string; expectedHash: string },
    BasicOutput
  >(createDeleteTool(root), {
    path: "large.txt",
    expectedHash: sha256(largeContent),
  });
  assert.equal(deleteLarge.ok, false);
  assert.match(deleteLarge.error, /large/i);
});

test("approval metadata describes file operation risks", () => {
  const root = tempRoot();
  const deleteApproval = buildToolApprovalMetadata({
    toolName: "delete",
    workspaceRoot: root,
    input: { path: "src/old.ts", expectedHash: "abc123" },
  });
  assert.equal(deleteApproval?.title, "Delete workspace path");
  assert.deepEqual(deleteApproval?.riskCategories, ["delete"]);
  assert.ok(deleteApproval?.details.some((detail) => /expected hash/i.test(detail)));

  const copyApproval = buildToolApprovalMetadata({
    toolName: "copy",
    workspaceRoot: root,
    input: {
      sourcePath: "src/a.ts",
      destinationPath: "src/b.ts",
      expectedSourceHash: "abc123",
    },
  });
  assert.equal(copyApproval?.title, "Copy workspace path");
  assert.deepEqual(copyApproval?.riskCategories, ["write"]);
});

async function runTool<TInput, TOutput>(
  tool: unknown,
  input: TInput,
): Promise<TOutput> {
  const executable = tool as ToolLike<TInput, TOutput>;
  return await executable.execute(input);
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anton-file-ops-"));
}

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}
