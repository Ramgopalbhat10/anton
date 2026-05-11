import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildToolApprovalMetadata } from "../src/agent/permissions";
import { createEditFileTool } from "../src/agent/tools/edit-file";
import { createReadFileTool } from "../src/agent/tools/read-file";
import { createWriteFileTool } from "../src/agent/tools/write-file";
import {
  getApprovalMetadata,
  type ToolTraceEntry,
} from "../src/lib/trace";

type ToolLike<TInput, TOutput> = {
  execute: (input: TInput, options?: unknown) => Promise<TOutput> | TOutput;
};

type ReadFileInput = {
  path: string;
  startLine?: number;
  endLine?: number;
};

type ReadFileOutput =
  | {
      ok: true;
      content: string;
      sha256: string;
      sizeBytes: number;
    }
  | { ok: false; error: string };

type EditFileInput = {
  path: string;
  patch: string;
  expectedHash: string;
};

type EditFileOutput =
  | {
      ok: true;
      path: string;
      previousContent: string;
      nextContent: string;
      previousHash: string;
      nextHash: string;
      bytesWritten: number;
    }
  | { ok: false; error: string };

type WriteFileInput = {
  path: string;
  content: string;
  expectedHash?: string;
};

type WriteFileOutput =
  | {
      ok: true;
      path: string;
      existed: boolean;
      previousHash?: string;
      nextHash: string;
    }
  | { ok: false; error: string };

test("read_file returns content hash and size", async () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "sample.txt"), "alpha\nbeta\n", "utf8");

  const output = await runTool<ReadFileInput, ReadFileOutput>(
    createReadFileTool(root),
    { path: "sample.txt" },
  );

  assert.equal(output.ok, true);
  assert.equal(output.sizeBytes, Buffer.byteLength("alpha\nbeta\n", "utf8"));
  assert.equal(output.sha256, sha256("alpha\nbeta\n"));
});

test("edit_file applies a single-file patch with hash conflict detection", async () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "sample.txt"), "alpha\nbeta\ngamma\n", "utf8");
  const expectedHash = sha256("alpha\nbeta\ngamma\n");

  const output = await runTool<EditFileInput, EditFileOutput>(
    createEditFileTool(root),
    {
      path: "sample.txt",
      expectedHash,
      patch: [
        "--- sample.txt",
        "+++ sample.txt",
        "@@ -1,3 +1,3 @@",
        " alpha",
        "-beta",
        "+bravo",
        " gamma",
        "",
      ].join("\n"),
    },
  );

  assert.equal(output.ok, true);
  assert.equal(output.path, "sample.txt");
  assert.equal(output.previousContent, "alpha\nbeta\ngamma\n");
  assert.equal(output.nextContent, "alpha\nbravo\ngamma\n");
  assert.equal(output.previousHash, expectedHash);
  assert.equal(output.nextHash, sha256("alpha\nbravo\ngamma\n"));
  assert.equal(
    fs.readFileSync(path.join(root, "sample.txt"), "utf8"),
    "alpha\nbravo\ngamma\n",
  );
});

test("edit_file rejects stale hashes", async () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "sample.txt"), "current\n", "utf8");

  const output = await runTool<EditFileInput, EditFileOutput>(
    createEditFileTool(root),
    {
      path: "sample.txt",
      expectedHash: sha256("old\n"),
      patch: [
        "--- sample.txt",
        "+++ sample.txt",
        "@@ -1 +1 @@",
        "-current",
        "+next",
        "",
      ].join("\n"),
    },
  );

  assert.equal(output.ok, false);
  assert.match(output.error, /hash mismatch/i);
  assert.equal(fs.readFileSync(path.join(root, "sample.txt"), "utf8"), "current\n");
});

test("edit_file rejects unsupported patch shapes and binary files", async () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "sample.txt"), "alpha\nbeta\n", "utf8");
  fs.writeFileSync(path.join(root, "binary.bin"), Buffer.from([0, 159, 146, 150]));
  const hash = sha256("alpha\nbeta\n");
  const editTool = createEditFileTool(root);

  for (const scenario of [
    {
      name: "multi-file",
      path: "sample.txt",
      expectedHash: hash,
      patch: [
        "--- sample.txt",
        "+++ sample.txt",
        "@@ -1 +1 @@",
        "-alpha",
        "+bravo",
        "--- other.txt",
        "+++ other.txt",
        "@@ -1 +1 @@",
        "-one",
        "+two",
        "",
      ].join("\n"),
      pattern: /single-file/i,
    },
    {
      name: "create",
      path: "sample.txt",
      expectedHash: hash,
      patch: [
        "--- /dev/null",
        "+++ sample.txt",
        "@@ -0,0 +1 @@",
        "+created",
        "",
      ].join("\n"),
      pattern: /create|delete|rename/i,
    },
    {
      name: "non-applicable",
      path: "sample.txt",
      expectedHash: hash,
      patch: [
        "--- sample.txt",
        "+++ sample.txt",
        "@@ -1 +1 @@",
        "-missing",
        "+next",
        "",
      ].join("\n"),
      pattern: /could not apply/i,
    },
    {
      name: "binary",
      path: "binary.bin",
      expectedHash: sha256(Buffer.from([0, 159, 146, 150])),
      patch: [
        "--- binary.bin",
        "+++ binary.bin",
        "@@ -1 +1 @@",
        "-x",
        "+y",
        "",
      ].join("\n"),
      pattern: /binary|utf-8/i,
    },
  ]) {
    const output = await runTool<EditFileInput, EditFileOutput>(editTool, {
      path: scenario.path,
      expectedHash: scenario.expectedHash,
      patch: scenario.patch,
    });
    assert.equal(output.ok, false, scenario.name);
    assert.match(output.error, scenario.pattern, scenario.name);
  }
});

test("write_file creates new files but requires expectedHash for replacement", async () => {
  const root = tempRoot();
  const writeTool = createWriteFileTool(root);

  const createOutput = await runTool<WriteFileInput, WriteFileOutput>(writeTool, {
    path: "created.txt",
    content: "created\n",
  });

  assert.equal(createOutput.ok, true);
  assert.equal(createOutput.existed, false);
  assert.equal(createOutput.nextHash, sha256("created\n"));

  const replaceWithoutHash = await runTool<WriteFileInput, WriteFileOutput>(writeTool, {
    path: "created.txt",
    content: "replacement\n",
  });

  assert.equal(replaceWithoutHash.ok, false);
  assert.match(replaceWithoutHash.error, /expectedHash/i);
  assert.equal(fs.readFileSync(path.join(root, "created.txt"), "utf8"), "created\n");

  const replaceWithHash = await runTool<WriteFileInput, WriteFileOutput>(writeTool, {
    path: "created.txt",
    content: "replacement\n",
    expectedHash: sha256("created\n"),
  });

  assert.equal(replaceWithHash.ok, true);
  assert.equal(replaceWithHash.existed, true);
  assert.equal(replaceWithHash.previousHash, sha256("created\n"));
  assert.equal(replaceWithHash.nextHash, sha256("replacement\n"));
});

test("approval metadata includes capped diff previews for edits and replacements", () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "sample.txt"), "alpha\nbeta\n", "utf8");
  const patch = [
    "--- sample.txt",
    "+++ sample.txt",
    "@@ -1,2 +1,2 @@",
    " alpha",
    "-beta",
    "+bravo",
    "",
  ].join("\n");

  const editApproval = buildToolApprovalMetadata({
    toolName: "edit_file",
    workspaceRoot: root,
    input: {
      path: "sample.txt",
      expectedHash: sha256("alpha\nbeta\n"),
      patch,
    },
  });

  assert.ok(editApproval?.diffPreview);
  assert.equal(editApproval.diffPreview.previous, "alpha\nbeta\n");
  assert.equal(editApproval.diffPreview.next, "alpha\nbravo\n");
  assert.equal(editApproval.diffPreview.truncated, false);

  const writeApproval = buildToolApprovalMetadata({
    toolName: "write_file",
    workspaceRoot: root,
    input: {
      path: "sample.txt",
      expectedHash: sha256("alpha\nbeta\n"),
      content: "alpha\nreplacement\n",
    },
  });

  assert.ok(writeApproval?.diffPreview);
  assert.equal(writeApproval.diffPreview.previous, "alpha\nbeta\n");
  assert.equal(writeApproval.diffPreview.next, "alpha\nreplacement\n");

  const oversized = "x".repeat(140 * 1024);
  fs.writeFileSync(path.join(root, "large.txt"), oversized, "utf8");
  const largeApproval = buildToolApprovalMetadata({
    toolName: "write_file",
    workspaceRoot: root,
    input: {
      path: "large.txt",
      expectedHash: sha256(oversized),
      content: `${oversized}y`,
    },
  });

  assert.equal(largeApproval?.diffPreview, undefined);
  assert.ok(largeApproval?.details.some((detail) => /too large/i.test(detail)));
});

test("pending edit approvals derive diff previews without activity metadata", () => {
  const entry: ToolTraceEntry = {
    id: "tool-call-1",
    sourceMessageId: "message-1",
    name: "edit_file",
    state: "approval-requested",
    input: {
      path: "package.json",
      patch: [
        "--- package.json",
        "+++ package.json",
        "@@ -1,4 +1,4 @@",
        " {",
        "   \"name\": \"anton\",",
        "-  \"version\": \"0.1.0\",",
        "+  \"version\": \"0.1.1\",",
        "",
      ].join("\n"),
      expectedHash: "abc123",
    },
    output: undefined,
    errorText: undefined,
    approvalId: "approval-1",
  };

  const approval = getApprovalMetadata(entry);

  assert.equal(approval?.title, "Patch workspace file");
  assert.equal(approval?.diffPreview?.path, "package.json");
  assert.match(approval?.diffPreview?.previous ?? "", /"version": "0\.1\.0"/);
  assert.match(approval?.diffPreview?.next ?? "", /"version": "0\.1\.1"/);
});

async function runTool<TInput, TOutput>(
  tool: unknown,
  input: TInput,
): Promise<TOutput> {
  const executable = tool as ToolLike<TInput, TOutput>;
  return await executable.execute(input);
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anton-edit-tool-"));
}

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}
