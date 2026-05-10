import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REDACTED,
  redactRecordSecrets,
  redactText,
  redactValue,
} from "../src/lib/redaction";

test("redacts key-value secrets and auth headers in text", () => {
  const openRouterKey = `sk-or-v1-${"a".repeat(32)}`;
  const githubToken = `ghp_${"b".repeat(36)}`;
  const basicAuth = "dXNlcjpzdXBlcnNlY3JldA==";
  const input = [
    `OPENROUTER_API_KEY=${openRouterKey}`,
    `Authorization: Bearer ${githubToken}`,
    `GIT_CONFIG_VALUE_0=AUTHORIZATION: basic ${basicAuth}`,
  ].join("\n");

  const output = redactText(input);
  assert.equal(output.includes(openRouterKey), false);
  assert.equal(output.includes(githubToken), false);
  assert.equal(output.includes(basicAuth), false);
  assert.match(output, /\[redacted\]/);
});

test("redacts nested structured secret values", () => {
  const output = redactValue({
    ok: true,
    token: `ghs_${"c".repeat(36)}`,
    nested: {
      headers: {
        Authorization: `Bearer sk-or-v1-${"d".repeat(32)}`,
      },
      visible: "hello",
    },
  });

  assert.deepEqual(output, {
    ok: true,
    token: REDACTED,
    nested: {
      headers: {
        Authorization: REDACTED,
      },
      visible: "hello",
    },
  });
});

test("redacts only secret-looking record values", () => {
  assert.deepEqual(
    redactRecordSecrets({
      NODE_ENV: "development",
      API_KEY: "super-secret",
      Authorization: "Bearer token-value",
    }),
    {
      NODE_ENV: "development",
      API_KEY: REDACTED,
      Authorization: REDACTED,
    },
  );
});
