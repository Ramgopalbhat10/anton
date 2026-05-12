import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildToolApprovalMetadata } from "../src/agent/permissions";
import {
  createFormatTool,
  planFormatCommand,
} from "../src/agent/tools/format";

type ToolLike<TInput, TOutput> = {
  execute: (input: TInput, options?: unknown) => Promise<TOutput> | TOutput;
};

test("format planner follows the workspace package manager and format script", () => {
  const root = tempRoot();
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      packageManager: "pnpm@10.0.0",
      scripts: { format: "prettier --write ." },
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfile\n", "utf8");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export{}\n", "utf8");

  const plan = planFormatCommand(root, { paths: ["src/index.ts"] });

  assert.equal(plan.ok, true);
  assert.equal(plan.packageManager, "pnpm");
  assert.deepEqual(plan.command, ["pnpm", "run", "format", "--", "src/index.ts"]);
  assert.deepEqual(plan.paths, ["src/index.ts"]);
});

test("format tool rejects unsafe paths and reports missing formatter scripts", async () => {
  const root = tempRoot();
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { lint: "eslint" } }),
    "utf8",
  );

  const missingFormatter = await runTool<
    { paths: string[] },
    { ok: false; error: string }
  >(createFormatTool(root), { paths: ["src/index.ts"] });
  assert.equal(missingFormatter.ok, false);
  assert.match(missingFormatter.error, /format script|formatter dependency/i);

  const traversal = await runTool<
    { paths: string[] },
    { ok: false; error: string }
  >(createFormatTool(root), { paths: ["../outside.ts"] });
  assert.equal(traversal.ok, false);
  assert.match(traversal.error, /escapes workspace|absolute paths/i);
});

test("format approval metadata describes formatter command and targets", () => {
  const root = tempRoot();
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      packageManager: "npm@10.0.0",
      scripts: { format: "prettier --write ." },
    }),
    "utf8",
  );

  const approval = buildToolApprovalMetadata({
    toolName: "format",
    workspaceRoot: root,
    input: { paths: ["src/index.ts"] },
  });

  assert.equal(approval?.title, "Format workspace files");
  assert.deepEqual(approval?.riskCategories, ["write"]);
  assert.ok(approval?.details.some((detail) => /npm run format/i.test(detail)));
  assert.ok(approval?.details.some((detail) => /src\/index\.ts/i.test(detail)));
});

async function runTool<TInput, TOutput>(
  tool: unknown,
  input: TInput,
): Promise<TOutput> {
  const executable = tool as ToolLike<TInput, TOutput>;
  return await executable.execute(input);
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anton-format-tool-"));
}
