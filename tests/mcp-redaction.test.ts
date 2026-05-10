import assert from "node:assert/strict";
import { test } from "node:test";

import {
  preserveRedactedMcpConfigValues,
  redactMcpConfig,
  type McpServerConfig,
} from "../src/agent/mcp-config";
import { REDACTED } from "../src/lib/redaction";

test("redacts MCP env and header secrets for UI-facing configs", () => {
  const stdio: McpServerConfig = {
    type: "stdio",
    command: "node",
    args: ["server.js"],
    env: {
      NODE_ENV: "development",
      API_KEY: "secret",
    },
  };
  const remote: McpServerConfig = {
    type: "http",
    url: "https://example.test/mcp",
    headers: {
      Authorization: "Bearer secret",
      Accept: "application/json",
    },
    redirect: "error",
  };

  assert.deepEqual(redactMcpConfig(stdio), {
    ...stdio,
    env: { NODE_ENV: "development", API_KEY: REDACTED },
  });
  assert.deepEqual(redactMcpConfig(remote), {
    ...remote,
    headers: { Authorization: REDACTED, Accept: "application/json" },
  });
});

test("preserves existing MCP secret values when UI submits redacted sentinel", () => {
  const current: McpServerConfig = {
    type: "http",
    url: "https://example.test/mcp",
    headers: {
      Authorization: "Bearer existing",
      Accept: "application/json",
    },
    redirect: "error",
  };
  const next: McpServerConfig = {
    ...current,
    headers: {
      Authorization: REDACTED,
      Accept: "application/json",
    },
  };

  assert.deepEqual(preserveRedactedMcpConfigValues(next, current), current);
});
