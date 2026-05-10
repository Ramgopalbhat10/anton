import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildBashEnvironment,
  classifyBashCommand,
  evaluateBashCommandPolicy,
} from "../src/agent/command-policy";

test("classifies read-only and risky command categories", () => {
  assert.deepEqual(classifyBashCommand("ls && git status").categories, [
    "read-only",
    "git",
  ]);
  assert.deepEqual(classifyBashCommand("curl https://example.com").categories, [
    "network",
    "external-integration",
  ]);
  assert.ok(
    classifyBashCommand("pnpm install").categories.includes("package-install"),
  );
  assert.ok(classifyBashCommand("pnpm dev").categories.includes("long-running-process"));
  assert.ok(classifyBashCommand("rm -rf dist").categories.includes("delete"));
  assert.ok(classifyBashCommand("echo hi > out.txt").categories.includes("write"));
});

test("refuses forbidden and secret-printing commands before execution", () => {
  for (const command of [
    "sudo whoami",
    "su root",
    "env",
    "printenv",
    "cat .env.local",
    "rg OPENROUTER_API_KEY .env",
    "cat id_rsa",
  ]) {
    const policy = evaluateBashCommandPolicy(command, {
      workspaceRoot: process.cwd(),
    });
    assert.equal(policy.allowed, false, command);
  }
});

test("refuses destructive and out-of-workspace path usage", () => {
  const root = process.cwd();
  for (const command of [
    "rm -rf /",
    "rm -rf ~",
    "rm -rf ..",
    "rm -rf *",
    "cat /etc/passwd",
    "echo hi > ../outside.txt",
  ]) {
    const policy = evaluateBashCommandPolicy(command, { workspaceRoot: root });
    assert.equal(policy.allowed, false, command);
  }
});

test("allows common safe commands inside the workspace", () => {
  for (const command of ["pwd", "ls src", "git diff -- src/agent/permissions.ts"]) {
    const policy = evaluateBashCommandPolicy(command, {
      workspaceRoot: process.cwd(),
    });
    assert.equal(policy.allowed, true, command);
  }
});

test("bash environment allowlist excludes Anton and arbitrary secrets", () => {
  const env = buildBashEnvironment({
    PATH: "bin",
    OPENROUTER_API_KEY: "not-a-real-openrouter-key",
    GITHUB_APP_PRIVATE_KEY: "private-key",
    CUSTOM_SECRET: "secret",
    ComSpec: "cmd.exe",
    SystemRoot: "C:\\Windows",
  });
  assert.equal(env.PATH, "bin");
  assert.equal(env.ComSpec, "cmd.exe");
  assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal("OPENROUTER_API_KEY" in env, false);
  assert.equal("GITHUB_APP_PRIVATE_KEY" in env, false);
  assert.equal("CUSTOM_SECRET" in env, false);
});
