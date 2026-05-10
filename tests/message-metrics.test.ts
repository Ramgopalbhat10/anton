import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatMetricNumber,
  messageMetrics,
} from "../components/features/chat/message-metrics";
import {
  hydrateMessagesWithRunMetrics,
  type AntonUIMessage,
} from "../src/lib/trace";

test("formatMetricNumber treats NaN as missing", () => {
  assert.equal(formatMetricNumber(Number.NaN), "-");
  assert.equal(formatMetricNumber(undefined), "-");
  assert.equal(formatMetricNumber(1234), "1,234");
});

test("messageMetrics ignores non-finite token values from metadata and run data", () => {
  const message = {
    id: "assistant-1",
    role: "assistant",
    metadata: {
      model: "anthropic/claude-haiku-4.5",
      inputTokens: Number.NaN,
      outputTokens: Number.NaN,
      totalTokens: Number.NaN,
      costUsd: 0.0096,
      durationMs: 31_000,
    },
    parts: [
      {
        type: "data-run",
        id: "run-1",
        data: {
          runId: "run-1",
          model: "anthropic/claude-haiku-4.5",
          status: "completed",
          startedAt: 1,
          finishedAt: 31_001,
          durationMs: 31_000,
          inputTokens: Number.NaN,
          outputTokens: Number.NaN,
          totalTokens: Number.NaN,
          costUsd: 0.0096,
        },
      },
    ],
  } as unknown as AntonUIMessage;

  assert.deepEqual(messageMetrics(message), {
    model: "anthropic/claude-haiku-4.5",
    durationMs: 31_000,
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
    costUsd: 0.0096,
  });
});

test("hydrates redacted persisted token metrics from run records", () => {
  const message = {
    id: "assistant-1",
    role: "assistant",
    metadata: {
      runId: "run-1",
      model: "anthropic/claude-haiku-4.5",
      inputTokens: "[redacted]",
      outputTokens: "[redacted]",
      totalTokens: "[redacted]",
      costUsd: 0.003842,
    },
    parts: [
      {
        type: "data-run",
        id: "run-1",
        data: {
          runId: "run-1",
          model: "anthropic/claude-haiku-4.5",
          status: "completed",
          startedAt: 1,
          finishedAt: 2,
          inputTokens: "[redacted]",
          outputTokens: "[redacted]",
          totalTokens: "[redacted]",
          costUsd: 0.003842,
        },
      },
    ],
  } as unknown as AntonUIMessage;

  const [hydrated] = hydrateMessagesWithRunMetrics([message], [
    {
      id: "run-1",
      inputTokens: 6628,
      outputTokens: 183,
      totalTokens: 6811,
      costUsd: 0.003842,
    },
  ]);

  assert.deepEqual(messageMetrics(hydrated), {
    model: "anthropic/claude-haiku-4.5",
    durationMs: 1,
    inputTokens: 6628,
    outputTokens: 183,
    totalTokens: 6811,
    costUsd: 0.003842,
  });
});
