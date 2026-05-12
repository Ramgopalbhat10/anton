import assert from "node:assert/strict";
import { test } from "node:test";

import type { ToolTraceEntry } from "../src/lib/trace";
import { toolTitle } from "../components/features/run-trace/trace-data";
import { effectiveToolState } from "../components/features/run-trace/tool-display";

test("trace display treats ok false tool outputs as failures", () => {
  const entry: ToolTraceEntry = {
    id: "tool-1",
    sourceMessageId: "message-1",
    name: "format",
    state: "output-available",
    input: { paths: ["tsconfig.json"] },
    output: {
      ok: false,
      error: "No package.json format script or supported formatter dependency was found.",
    },
    errorText: undefined,
    approvalId: undefined,
  };

  assert.equal(effectiveToolState(entry), "output-error");
  assert.deepEqual(toolTitle(entry), {
    verb: "Format failed",
    target: "tsconfig.json",
  });
});
