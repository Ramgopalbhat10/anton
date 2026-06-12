import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  evaluateBashCommandPolicy,
} from "@/src/agent/command-policy";
import {
  commandPolicyModeForPermission,
  type CommandPolicyMode,
  type PermissionMode,
  type ToolRiskCategory,
} from "@/src/agent/permissions";
import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import {
  detectPackageManager,
  readPackageJson,
  runScriptCommand,
} from "@/src/agent/tools/package-manager";
import {
  clearRecentBackgroundCommandSessions,
  createBackgroundCommandSession,
  getBackgroundCommandSession,
  getRunningBackgroundCommandForProject,
  listBackgroundCommandSessionsForProject,
  markStaleBackgroundCommandSessions,
  updateBackgroundCommandSession,
} from "@/src/db/queries";
import type { BackgroundCommandSession } from "@/src/db/schema";
import { backgroundCommandStream } from "@/src/lib/background-command-stream";
import { redactText } from "@/src/lib/redaction";
import {
  startWorkspaceProcess,
  type StartedWorkspaceProcess,
} from "@/src/workspace/process-runner";

const execFileAsync = promisify(execFile);

const MAX_TAIL_BYTES = 64 * 1024;
const RECENT_LIMIT = 20;
const TERMINATION_GRACE_MS = 3_000;
const TERMINAL_WAIT_MS = 10_000;

const ACTIVE_STATUSES = new Set(["starting", "running", "stopping"]);
const FINALIZABLE_STATUSES = new Set([...ACTIVE_STATUSES, "stale"]);
const LOCALHOST_URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/[^\s"'<>]*)?/gi;

type ActiveProcess = {
  subprocess: StartedWorkspaceProcess["subprocess"];
};

const activeProcesses = new Map<string, ActiveProcess>();
const userStopRequestedSessions = new Set<string>();

const globalForBackgroundCommands = globalThis as typeof globalThis & {
  __antonBackgroundCommandsBootstrapped?: boolean;
};

function ensureBootstrapped(): void {
  if (globalForBackgroundCommands.__antonBackgroundCommandsBootstrapped) return;
  globalForBackgroundCommands.__antonBackgroundCommandsBootstrapped = true;
  markStaleBackgroundCommandSessions();
}

export type StartBackgroundCommandInput =
  | { kind: "script"; scriptName: string }
  | { kind: "custom"; command: string };

export type StartBackgroundCommandResult =
  | { ok: true; session: BackgroundCommandSession; streamToken: string }
  | { ok: false; error: string; status?: number };

export type PreflightBackgroundCommandResult =
  | {
      ok: true;
      allowed: boolean;
      risky: boolean;
      categories: ToolRiskCategory[];
      commandPolicyMode: CommandPolicyMode;
      reason: string;
    }
  | { ok: false; error: string; status?: number };

export function preflightProjectBackgroundCommand(
  projectRoot: string,
  command: string,
  permissionMode: PermissionMode = "auto-review",
): PreflightBackgroundCommandResult {
  ensureBootstrapped();
  const trimmed = command.trim();
  if (!trimmed) {
    return { ok: false, error: "Command is required.", status: 400 };
  }

  const root = ensureWorkspaceRootAt(projectRoot);
  const policy = evaluateBashCommandPolicy(trimmed, { workspaceRoot: root });
  const commandPolicyMode = commandPolicyModeForPermission(permissionMode);
  const categories = [...policy.classification.categories];
  if (commandPolicyMode === "enforced" && !policy.allowed) {
    return {
      ok: true,
      allowed: false,
      risky: false,
      categories,
      commandPolicyMode,
      reason: policy.reason,
    };
  }

  const risky =
    commandPolicyMode === "enforced" &&
    categories.some((category) => category !== "read-only");
  return {
    ok: true,
    allowed: true,
    risky,
    categories,
    commandPolicyMode,
    reason: policy.classification.reason,
  };
}

export function listProjectBackgroundCommands(projectId: string): {
  running: BackgroundCommandSession[];
  recent: BackgroundCommandSession[];
  runningCount: number;
} {
  ensureBootstrapped();
  const sessions = listBackgroundCommandSessionsForProject(projectId, RECENT_LIMIT);
  const running = sessions.filter((session) => ACTIVE_STATUSES.has(session.status));
  const recent = sessions.filter((session) => !ACTIVE_STATUSES.has(session.status));
  return {
    running,
    recent,
    runningCount: running.filter(
      (session) => session.status === "running" || session.status === "starting",
    ).length,
  };
}

export function getProjectBackgroundCommand(
  projectId: string,
  commandId: string,
): BackgroundCommandSession | undefined {
  ensureBootstrapped();
  const session = getBackgroundCommandSession(commandId);
  if (!session || session.projectId !== projectId) return undefined;
  return session;
}

export function clearProjectRecentBackgroundCommands(projectId: string): number {
  ensureBootstrapped();
  return clearRecentBackgroundCommandSessions(projectId);
}

export async function startProjectBackgroundCommand(
  projectId: string,
  projectRoot: string,
  input: StartBackgroundCommandInput,
  permissionMode: PermissionMode = "auto-review",
): Promise<StartBackgroundCommandResult> {
  ensureBootstrapped();
  const root = ensureWorkspaceRootAt(projectRoot);

  let command = "";
  const commandKind: "script" | "custom" = input.kind;
  let spawnArgs: { file: string; args: string[]; shell?: false } | {
    file: string;
    args: string[];
    shell: true;
  };

  if (input.kind === "script") {
    const packageJson = readPackageJson(root);
    if (!packageJson.ok) {
      return { ok: false, error: packageJson.error, status: 400 };
    }
    const scripts = packageJson.value.scripts ?? {};
    if (typeof scripts[input.scriptName] !== "string") {
      return { ok: false, error: `Script "${input.scriptName}" not found.`, status: 404 };
    }
    const packageManager = detectPackageManager(root, packageJson.value);
    const argv = runScriptCommand(packageManager, input.scriptName);
    command = `${argv.join(" ")}`;
    spawnArgs = { file: argv[0]!, args: argv.slice(1), shell: false };
  } else {
    command = input.command.trim();
    if (!command) {
      return { ok: false, error: "Command is required.", status: 400 };
    }
    const policy = evaluateBashCommandPolicy(command, { workspaceRoot: root });
    const commandPolicyMode = commandPolicyModeForPermission(permissionMode);
    if (commandPolicyMode === "enforced" && !policy.allowed) {
      return { ok: false, error: policy.reason, status: 403 };
    }
    spawnArgs = { file: "bash", args: ["-lc", command], shell: false };
  }

  const duplicate = getRunningBackgroundCommandForProject(projectId, command);
  if (duplicate) {
    return {
      ok: false,
      error: "An identical command is already running for this project.",
      status: 409,
    };
  }

  const now = new Date();
  const session = createBackgroundCommandSession({
    id: randomUUID(),
    projectId,
    command,
    commandKind,
    status: "starting",
    startedAt: now,
    stdoutTail: "",
    stderrTail: "",
    detectedUrls: [],
    createdBy: null,
  });

  const streamToken = backgroundCommandStream.startStream(session.id, {
    status: "starting",
  });

  try {
    await spawnSessionProcess(session.id, root, spawnArgs);
    const updated = getBackgroundCommandSession(session.id);
    if (!updated) {
      return { ok: false, error: "Failed to start command session.", status: 500 };
    }
    return { ok: true, session: updated, streamToken };
  } catch (err) {
    const message = redactText(errorMessage(err));
    updateBackgroundCommandSession(session.id, {
      status: "failed",
      finishedAt: new Date(),
      stderrTail: capTail(message),
    });
    backgroundCommandStream.emitEvent(session.id, {
      type: "status",
      status: "failed",
      exitCode: null,
      signal: null,
    });
    backgroundCommandStream.endStream(session.id);
    return { ok: false, error: message, status: 500 };
  }
}

export async function stopProjectBackgroundCommand(
  projectId: string,
  commandId: string,
): Promise<{ ok: true; session: BackgroundCommandSession } | { ok: false; error: string; status?: number }> {
  ensureBootstrapped();
  const session = getProjectBackgroundCommand(projectId, commandId);
  if (!session) {
    return { ok: false, error: "Command session not found.", status: 404 };
  }
  if (!ACTIVE_STATUSES.has(session.status)) {
    return { ok: false, error: "Command is not running.", status: 400 };
  }

  userStopRequestedSessions.add(commandId);
  updateBackgroundCommandSession(commandId, { status: "stopping" });
  backgroundCommandStream.emitEvent(commandId, { type: "status", status: "stopping" });

  await terminateProcess(commandId);
  await waitForSessionTerminal(commandId);

  const updated = getBackgroundCommandSession(commandId);
  if (!updated) {
    return { ok: false, error: "Command session not found.", status: 404 };
  }
  return { ok: true, session: updated };
}

export async function restartProjectBackgroundCommand(
  projectId: string,
  commandId: string,
  projectRoot: string,
  permissionMode: PermissionMode = "auto-review",
): Promise<StartBackgroundCommandResult> {
  ensureBootstrapped();
  const session = getProjectBackgroundCommand(projectId, commandId);
  if (!session) {
    return { ok: false, error: "Command session not found.", status: 404 };
  }

  if (ACTIVE_STATUSES.has(session.status)) {
    userStopRequestedSessions.add(commandId);
    updateBackgroundCommandSession(commandId, { status: "stopping" });
    backgroundCommandStream.emitEvent(commandId, { type: "status", status: "stopping" });
    await terminateProcess(commandId);
    await waitForSessionTerminal(commandId);
  }

  const duplicate = getRunningBackgroundCommandForProject(projectId, session.command);
  if (duplicate && duplicate.id !== commandId) {
    return {
      ok: false,
      error: "An identical command is already running for this project.",
      status: 409,
    };
  }

  userStopRequestedSessions.delete(commandId);

  const root = ensureWorkspaceRootAt(projectRoot);
  const spawnArgs = spawnArgsForSession(session, root, permissionMode);
  if (!spawnArgs.ok) {
    return { ok: false, error: spawnArgs.error, status: 400 };
  }

  const now = new Date();
  updateBackgroundCommandSession(commandId, {
    status: "starting",
    pid: null,
    startedAt: now,
    finishedAt: null,
    exitCode: null,
    signal: null,
    stdoutTail: "",
    stderrTail: "",
    detectedUrls: [],
  });

  const streamToken = backgroundCommandStream.startStream(commandId, {
    status: "starting",
    stdout: "",
    stderr: "",
    detectedUrls: [],
    finished: false,
  });

  try {
    await spawnSessionProcess(commandId, root, spawnArgs.value);
    const updated = getBackgroundCommandSession(commandId);
    if (!updated) {
      return { ok: false, error: "Failed to restart command session.", status: 500 };
    }
    return { ok: true, session: updated, streamToken };
  } catch (err) {
    const message = redactText(errorMessage(err));
    updateBackgroundCommandSession(commandId, {
      status: "failed",
      finishedAt: new Date(),
      stderrTail: capTail(message),
    });
    backgroundCommandStream.emitEvent(commandId, {
      type: "status",
      status: "failed",
      exitCode: null,
      signal: null,
    });
    backgroundCommandStream.endStream(commandId);
    return { ok: false, error: message, status: 500 };
  }
}

export function getBackgroundCommandStreamToken(sessionId: string): string {
  ensureBootstrapped();
  return backgroundCommandStream.prepareStream(sessionId);
}

async function spawnSessionProcess(
  sessionId: string,
  cwd: string,
  spawnArgs: { file: string; args: string[]; shell?: false },
): Promise<void> {
  let stdoutTail = "";
  let stderrTail = "";
  let detectedUrls: string[] = [];

  const processHandle = startWorkspaceProcess(spawnArgs.file, spawnArgs.args, cwd, {
    cleanup: true,
    forceKillAfterDelay: false,
    detached: process.platform !== "win32",
    onStdout: (text) => {
      stdoutTail = capTail(stdoutTail + text);
      detectedUrls = mergeDetectedUrls(detectedUrls, detectLocalhostUrls(text));
      updateBackgroundCommandSession(sessionId, {
        stdoutTail,
        detectedUrls,
      });
      backgroundCommandStream.emitEvent(sessionId, { type: "stdout", chunk: text });
    },
    onStderr: (text) => {
      stderrTail = capTail(stderrTail + text);
      detectedUrls = mergeDetectedUrls(detectedUrls, detectLocalhostUrls(text));
      updateBackgroundCommandSession(sessionId, {
        stderrTail,
        detectedUrls,
      });
      backgroundCommandStream.emitEvent(sessionId, { type: "stderr", chunk: text });
    },
  });
  const { subprocess } = processHandle;

  activeProcesses.set(sessionId, { subprocess });

  updateBackgroundCommandSession(sessionId, {
    status: "running",
    pid: subprocess.pid ?? null,
    startedAt: new Date(),
  });
  backgroundCommandStream.emitEvent(sessionId, { type: "status", status: "running" });

  void subprocess.then((result) => {
    finalizeProcess(sessionId, {
      exitCode: result.exitCode ?? null,
      signal: result.signal ?? null,
      stdoutTail,
      stderrTail,
      detectedUrls,
    });
  }).catch((err) => {
    finalizeProcess(sessionId, {
      exitCode: null,
      signal: null,
      stdoutTail,
      stderrTail: capTail(`${stderrTail}${redactText(errorMessage(err))}`),
      detectedUrls,
      failed: true,
    });
  });
}

async function terminateProcess(sessionId: string): Promise<void> {
  const active = activeProcesses.get(sessionId);
  if (!active) {
    forceFinalizeStoppedSession(sessionId);
    return;
  }

  const { subprocess } = active;
  const session = getBackgroundCommandSession(sessionId);
  await killProcessTreeGracefully(subprocess.pid, subprocess);

  const exit = await readSubprocessExit(subprocess);
  activeProcesses.delete(sessionId);

  if (session && ACTIVE_STATUSES.has(session.status)) {
    finalizeProcess(sessionId, {
      exitCode: exit.exitCode,
      signal: exit.signal,
      stdoutTail: session.stdoutTail,
      stderrTail: session.stderrTail,
      detectedUrls: session.detectedUrls,
    });
    return;
  }

  await waitForSessionTerminal(sessionId);
}

function forceFinalizeStoppedSession(sessionId: string): void {
  const session = getBackgroundCommandSession(sessionId);
  if (!session || !ACTIVE_STATUSES.has(session.status)) {
    userStopRequestedSessions.delete(sessionId);
    return;
  }

  finalizeProcess(sessionId, {
    exitCode: session.exitCode,
    signal: toProcessSignal(session.signal),
    stdoutTail: session.stdoutTail,
    stderrTail: session.stderrTail,
    detectedUrls: session.detectedUrls,
  });
}

async function readSubprocessExit(
  subprocess: StartedWorkspaceProcess["subprocess"],
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  try {
    const result = await Promise.race([
      subprocess,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), TERMINATION_GRACE_MS);
      }),
    ]);
    if (result && typeof result === "object" && "exitCode" in result) {
      return {
        exitCode: result.exitCode ?? null,
        signal: result.signal ?? null,
      };
    }
  } catch {
    // Process was rejected or interrupted.
  }

  return { exitCode: null, signal: "SIGKILL" };
}

async function killProcessTreeGracefully(
  pid: number | undefined,
  subprocess: StartedWorkspaceProcess["subprocess"],
): Promise<void> {
  await sendGracefulTermination(pid, subprocess);
  if (await waitForSubprocessExit(subprocess, TERMINATION_GRACE_MS)) {
    return;
  }

  await sendForceTermination(pid, subprocess);
  await waitForSubprocessExit(subprocess, TERMINATION_GRACE_MS);
}

async function sendGracefulTermination(
  pid: number | undefined,
  subprocess: StartedWorkspaceProcess["subprocess"],
): Promise<void> {
  if (pid !== undefined && process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T"], {
        windowsHide: true,
      });
      return;
    } catch {
      // Fall through to subprocess.kill below.
    }
  }

  if (pid !== undefined && process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGTERM");
      return;
    } catch {
      // Fall through to subprocess.kill below.
    }
  }

  try {
    subprocess.kill("SIGTERM");
  } catch {
    if (pid !== undefined && process.platform !== "win32") {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process already exited.
      }
    }
  }
}

async function sendForceTermination(
  pid: number | undefined,
  subprocess: StartedWorkspaceProcess["subprocess"],
): Promise<void> {
  if (pid !== undefined && process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
      });
      return;
    } catch {
      // Fall through to subprocess.kill below.
    }
  }

  if (pid !== undefined && process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // Fall through to subprocess.kill below.
    }
  }

  try {
    subprocess.kill("SIGKILL");
  } catch {
    if (pid !== undefined && process.platform !== "win32") {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already exited.
      }
    }
  }
}

async function waitForSubprocessExit(
  subprocess: StartedWorkspaceProcess["subprocess"],
  timeoutMs: number,
): Promise<boolean> {
  return Promise.race([
    subprocess
      .then(() => true)
      .catch(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
}

async function waitForSessionTerminal(
  sessionId: string,
  timeoutMs = TERMINAL_WAIT_MS,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const session = getBackgroundCommandSession(sessionId);
    if (!session || !ACTIVE_STATUSES.has(session.status)) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
}

function finalizeProcess(
  sessionId: string,
  input: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdoutTail: string;
    stderrTail: string;
    detectedUrls: string[];
    failed?: boolean;
  },
): void {
  activeProcesses.delete(sessionId);

  const current = getBackgroundCommandSession(sessionId);
  if (!current) {
    userStopRequestedSessions.delete(sessionId);
    backgroundCommandStream.endStream(sessionId);
    return;
  }

  if (!FINALIZABLE_STATUSES.has(current.status)) {
    userStopRequestedSessions.delete(sessionId);
    return;
  }

  const recoveringStale = current.status === "stale";

  const userStopped = userStopRequestedSessions.has(sessionId);
  userStopRequestedSessions.delete(sessionId);

  if (
    !recoveringStale &&
    (userStopped ||
      current.status === "stopped" ||
      current.status === "stopping")
  ) {
    updateBackgroundCommandSession(sessionId, {
      status: "stopped",
      finishedAt: current.finishedAt ?? new Date(),
      pid: null,
      exitCode: input.exitCode ?? current.exitCode,
      signal: input.signal ?? current.signal ?? "SIGTERM",
      stdoutTail: input.stdoutTail || current.stdoutTail,
      stderrTail: input.stderrTail || current.stderrTail,
      detectedUrls: input.detectedUrls.length > 0 ? input.detectedUrls : current.detectedUrls,
    });
    backgroundCommandStream.emitEvent(sessionId, {
      type: "status",
      status: "stopped",
      exitCode: input.exitCode ?? current.exitCode,
      signal: input.signal ?? current.signal ?? "SIGTERM",
      detectedUrls:
        input.detectedUrls.length > 0 ? input.detectedUrls : current.detectedUrls,
    });
    backgroundCommandStream.endStream(sessionId);
    return;
  }

  const status =
    input.failed || (input.exitCode !== null && input.exitCode !== 0)
      ? "failed"
      : "exited";

  updateBackgroundCommandSession(sessionId, {
    status,
    finishedAt: new Date(),
    pid: null,
    exitCode: input.exitCode,
    signal: input.signal,
    stdoutTail: input.stdoutTail,
    stderrTail: input.stderrTail,
    detectedUrls: input.detectedUrls,
  });

  backgroundCommandStream.emitEvent(sessionId, {
    type: "status",
    status,
    exitCode: input.exitCode,
    signal: input.signal,
    detectedUrls: input.detectedUrls,
  });
  backgroundCommandStream.endStream(sessionId);
}

function spawnArgsForSession(
  session: BackgroundCommandSession,
  root: string,
  permissionMode: PermissionMode,
):
  | { ok: true; value: { file: string; args: string[]; shell?: false } }
  | { ok: false; error: string } {
  if (session.commandKind === "custom") {
    const policy = evaluateBashCommandPolicy(session.command, { workspaceRoot: root });
    const commandPolicyMode = commandPolicyModeForPermission(permissionMode);
    if (commandPolicyMode === "enforced" && !policy.allowed) {
      return { ok: false, error: policy.reason };
    }
    return {
      ok: true,
      value: { file: "bash", args: ["-lc", session.command], shell: false },
    };
  }

  const parts = session.command.trim().split(/\s+/);
  if (parts.length === 0) {
    return { ok: false, error: "Invalid script command." };
  }
  return {
    ok: true,
    value: { file: parts[0]!, args: parts.slice(1), shell: false },
  };
}

function detectLocalhostUrls(text: string): string[] {
  const matches = text.match(LOCALHOST_URL_RE) ?? [];
  return [...new Set(matches)];
}

function mergeDetectedUrls(existing: string[], found: string[]): string[] {
  if (found.length === 0) return existing;
  return [...new Set([...existing, ...found])];
}

function capTail(output: string): string {
  const buf = Buffer.from(output, "utf8");
  if (buf.byteLength <= MAX_TAIL_BYTES) return output;
  return buf.subarray(buf.byteLength - MAX_TAIL_BYTES).toString("utf8");
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function toProcessSignal(signal: string | null): NodeJS.Signals | null {
  return signal as NodeJS.Signals | null;
}
