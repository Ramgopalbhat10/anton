import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { resolveInWorkspace, SandboxError } from "../src/agent/sandbox";
import {
  validateAndPrepareLocalWorkspacesRoot,
  WorkspaceRootError,
} from "../src/workspace/local";

test("resolveInWorkspace rejects traversal and absolute paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anton-sandbox-"));
  assert.throws(() => resolveInWorkspace("../outside.txt", root), SandboxError);
  assert.throws(() => resolveInWorkspace(path.join(root, "file.txt"), root), SandboxError);
});

test("resolveInWorkspace rejects symlink escapes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anton-sandbox-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "anton-outside-"));
  const link = path.join(root, "linked");
  fs.symlinkSync(outside, link, "junction");

  assert.throws(() => resolveInWorkspace("linked/secret.txt", root), SandboxError);
});

test("workspace root validation rejects unsafe roots", async () => {
  const cwd = process.cwd();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "anton-workspaces-"));
  const unsafeDirs = [
    cwd,
    os.homedir(),
    path.parse(cwd).root,
    path.join(temp, "repo", ".git", "workspaces"),
    path.join(temp, "repo", "node_modules", "workspaces"),
    path.join(temp, "repo", ".next", "workspaces"),
    path.join(temp, "repo", "dist", "workspaces"),
    path.join(temp, "repo", "build", "workspaces"),
  ];

  for (const dir of unsafeDirs) {
    await assert.rejects(
      validateAndPrepareLocalWorkspacesRoot(dir),
      WorkspaceRootError,
      dir,
    );
  }
});

test("workspace root validation accepts a dedicated absolute directory", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "anton-workspaces-"));
  const root = path.join(temp, "dedicated");
  const validated = await validateAndPrepareLocalWorkspacesRoot(root);
  assert.equal(validated, fs.realpathSync(root));
});
