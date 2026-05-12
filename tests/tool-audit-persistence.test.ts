import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "anton-tool-audit-"));
process.env.DATABASE_URL = path.join(dbDir, "audit.db");

type DbQueries = typeof import("../src/db/queries");

let queries: DbQueries | undefined;

async function loadQueries(): Promise<DbQueries> {
  if (!queries) {
    await import("../src/db/migrate");
    queries = await import("../src/db/queries");
  }
  return queries;
}

test("tool-call audit persistence records tool lifecycle and approvals", async () => {
  const {
    createRun,
    createSession,
    getToolApproval,
    getToolCall,
    listToolCallsForRun,
    updateToolCall,
    upsertToolApproval,
    upsertToolCall,
  } = await loadQueries();

  createSession({
    id: "session-1",
    title: "Audit test",
    model: "anthropic/claude-haiku-4.5",
  });

  const run = createRun({
    id: "run-1",
    sessionId: "session-1",
    model: "anthropic/claude-haiku-4.5",
    provider: "openrouter",
    status: "running",
    startedAt: new Date(1_000),
    stepCount: 0,
  });

  assert.equal(run.provider, "openrouter");
  assert.equal(run.stepCount, 0);

  const toolCall = upsertToolCall({
    id: "run-1:tool:call-1",
    runId: "run-1",
    toolCallId: "call-1",
    toolName: "bash",
    stepNumber: 1,
    status: "running",
    inputSummary: "pnpm test",
    approvalDecision: "pending",
    startedAt: new Date(2_000),
  });

  assert.equal(toolCall.toolName, "bash");
  assert.equal(toolCall.approvalDecision, "pending");

  const approval = upsertToolApproval({
    id: "run-1:tool:call-1:approval",
    toolCallId: toolCall.id,
    approvalId: "approval-1",
    decision: "pending",
    title: "Run shell command",
    summary: "Runs a shell command in the active workspace.",
    riskCategories: ["command"],
    metadata: { target: "pnpm test" },
    requestedAt: new Date(2_000),
  });

  assert.equal(approval.decision, "pending");
  assert.deepEqual(approval.riskCategories, ["command"]);

  const finished = updateToolCall(toolCall.id, {
    status: "error",
    approvalDecision: "approved",
    outputSummary: "Command failed",
    exitCode: 1,
    error: "Command failed",
    finishedAt: new Date(2_500),
    durationMs: 500,
  });

  assert.equal(finished?.status, "error");
  assert.equal(finished?.approvalDecision, "approved");
  assert.equal(finished?.exitCode, 1);

  const approved = upsertToolApproval({
    ...approval,
    decision: "approved",
    respondedAt: new Date(2_100),
  });

  assert.equal(approved.decision, "approved");
  assert.equal(approved.respondedAt?.getTime(), 2_100);

  const storedToolCall = getToolCall(toolCall.id);
  const storedApproval = getToolApproval(approval.id);
  const runToolCalls = listToolCallsForRun("run-1");

  assert.equal(storedToolCall?.durationMs, 500);
  assert.equal(storedApproval?.approvalId, "approval-1");
  assert.equal(runToolCalls.length, 1);
  assert.equal(runToolCalls[0]?.id, toolCall.id);
});

test("run metadata tracks final step count and provider cost metadata", async () => {
  const { createRun, createSession, updateRun } = await loadQueries();

  createSession({
    id: "session-2",
    title: "Run metadata test",
    model: "anthropic/claude-haiku-4.5",
  });

  createRun({
    id: "run-2",
    sessionId: "session-2",
    model: "anthropic/claude-haiku-4.5",
    provider: "openrouter",
    status: "running",
    startedAt: new Date(1_000),
  });

  const completed = updateRun("run-2", {
    status: "completed",
    finishedAt: new Date(3_000),
    durationMs: 2_000,
    stepCount: 3,
    costUsd: 0.0012,
    costMetadata: {
      provider: "openrouter",
      currency: "USD",
      source: "providerMetadata.openrouter.usage",
    },
  });

  assert.equal(completed?.stepCount, 3);
  assert.deepEqual(completed?.costMetadata, {
    provider: "openrouter",
    currency: "USD",
    source: "providerMetadata.openrouter.usage",
  });
});
