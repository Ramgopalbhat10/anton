import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runWorkspaceProcess } from "../src/agent/tools/process";

test("workspace process runner scrubs arbitrary secrets from child environment", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anton-process-runner-"));
  const previous = process.env.CUSTOM_SECRET;
  process.env.CUSTOM_SECRET = "do-not-leak";
  try {
    const result = await runWorkspaceProcess(
      process.execPath,
      ["-e", "process.stdout.write(process.env.CUSTOM_SECRET || '')"],
      root,
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
  } finally {
    if (previous === undefined) {
      delete process.env.CUSTOM_SECRET;
    } else {
      process.env.CUSTOM_SECRET = previous;
    }
  }
});
