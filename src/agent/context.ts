import {
  getToolName,
  isToolUIPart,
} from "ai";

import type { RunContextSummary } from "@/src/db/schema";
import {
  listRunContextSummariesForSession,
  upsertRunContextSummary,
} from "@/src/db/queries";
import type { AntonUIMessage } from "@/src/lib/trace";
import { redactText } from "@/src/lib/redaction";
import {
  outputExitCode,
  summarizeToolInput,
  summarizeToolOutput,
} from "@/src/lib/tool-summaries";

const RECENT_CONTEXT_COUNT = 5;
const DEFAULT_CONTEXT_BUDGET_CHARS = 6_000;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_TEXT_FIELD_CHARS = 1_200;
const MAX_DIGEST_BLOCK_CHARS = 1_500;
const MAX_DROPPED_HISTORY_DIGEST_CHARS = 1_500;
const MAX_DROPPED_MESSAGE_TEXT_CHARS = 500;

export type RunContextStatus = "completed" | "error" | "aborted";

type RunContextFile = {
  path: string;
  action: string;
};

type RunContextTodoItem = {
  text: string;
  status: "pending" | "in_progress" | "completed";
};

type RunContextTodo = {
  summary: string;
  itemCount: number;
  completedCount: number;
  current?: string;
  items: RunContextTodoItem[];
};

type RunContextVerification = {
  status: string;
  summary?: string;
  failureScope?: string;
  failureSummary?: string;
  recommendedNext?: string;
  editedPaths: string[];
  failedTargets: string[];
};

type RunContextBlocker = {
  reason: string;
  blockedTools: string[];
  forceFinal: boolean;
  affectedPath?: string;
  phase?: string;
  failureCode?: string;
  recommendedNext?: string;
};

type RunContextCommand = {
  command: string;
  exitCode: number | null;
  ok: boolean;
  timedOut: boolean;
  error?: string;
  stdoutTail?: string;
  stderrTail?: string;
};

type RunContextBudgetFact = {
  droppedMessages: number;
  preservedMessages: number;
  droppedHistoryDigestInjected: boolean;
  contextDigestBytes: number;
};

type RunContextTool = {
  name: string;
  status: "completed" | "error";
  input?: string;
  output?: string;
  exitCode?: number | null;
  error?: string;
  todo?: RunContextTodo;
  verification?: RunContextVerification;
  blocker?: RunContextBlocker;
  touchedFiles?: RunContextFile[];
};

export class RunContextCollector {
  private readonly facts = new Set<string>();
  private readonly files = new Map<string, RunContextFile>();
  private readonly commands: RunContextCommand[] = [];
  private readonly tools: RunContextTool[] = [];
  private terminalStatus: RunContextStatus = "completed";
  private terminalError: string | undefined;

  constructor(
    private readonly runId: string,
    private readonly sessionId: string,
  ) {}

  addTool(event: {
    toolName: string;
    input: unknown;
    success: boolean;
    output?: unknown;
    error?: unknown;
  }): void {
    const error = toolError(event.success, event.output, event.error);
    const status = error ? "error" : "completed";
    const inputSummary = summarizeToolInput(event.input, compactLine);
    const outputSummary = summarizeToolOutput(
      event.toolName,
      event.output,
      event.error,
      compactLine,
    );
    const exitCode = outputExitCode(event.output);
    const todo = todoFromToolOutput(event.toolName, event.output);
    const verification = verificationFromToolOutput(
      event.toolName,
      event.output,
    );
    const touchedFiles = touchedFilesFromTool(
      event.toolName,
      event.input,
      event.output,
      !error,
    );

    this.tools.push({
      name: event.toolName,
      status,
      ...(inputSummary ? { input: inputSummary } : {}),
      ...(outputSummary ? { output: outputSummary } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}),
      ...(error ? { error } : {}),
      ...(todo ? { todo } : {}),
      ...(verification ? { verification } : {}),
      ...(touchedFiles.length > 0 ? { touchedFiles } : {}),
    });

    this.collectFacts(event.toolName, event.input, event.output);
    for (const file of touchedFiles) {
      this.files.set(`${file.action}:${file.path}`, file);
    }
    this.collectCommand(event.toolName, event.input, event.output, error);
  }

  addLoopGuard(event: RunContextBlocker): void {
    const blocker = {
      ...event,
      reason: compactLine(event.reason, 500),
      blockedTools: event.blockedTools
        .map((tool) => compactLine(tool, 100))
        .filter(Boolean),
      ...(event.affectedPath
        ? { affectedPath: compactLine(event.affectedPath, 500) }
        : {}),
      ...(event.phase ? { phase: compactLine(event.phase, 100) } : {}),
      ...(event.failureCode
        ? { failureCode: compactLine(event.failureCode, 100) }
        : {}),
      ...(event.recommendedNext
        ? { recommendedNext: compactLine(event.recommendedNext, 300) }
        : {}),
    };
    this.tools.push({
      name: "loop_guard",
      status: blocker.forceFinal ? "error" : "completed",
      output: blocker.reason,
      blocker,
    });
  }

  noteContextBudget(input: RunContextBudgetFact): void {
    if (input.droppedMessages <= 0 && !input.droppedHistoryDigestInjected) {
      return;
    }
    const summary = [
      `Context budget: kept ${input.preservedMessages} message${input.preservedMessages === 1 ? "" : "s"}`,
      `dropped ${input.droppedMessages}`,
      input.droppedHistoryDigestInjected
        ? "dropped-history digest injected"
        : "dropped-history digest not injected",
      `context digest ${input.contextDigestBytes} bytes`,
    ].join("; ");
    this.addFact(summary);
    this.tools.push({
      name: "context_budget",
      status: "completed",
      output: summary,
    });
  }

  persist(input: {
    status: RunContextStatus;
    finalText?: string;
    error?: unknown;
  }): void {
    this.terminalStatus = input.status;
    this.terminalError = errorMessageOrUndefined(input.error);
    const now = new Date();
    upsertRunContextSummary({
      runId: this.runId,
      sessionId: this.sessionId,
      summary: this.buildSummary(input.finalText),
      facts: Array.from(this.facts),
      files: Array.from(this.files.values()),
      commands: this.commands,
      tools: this.tools,
      createdAt: now,
      updatedAt: now,
    });
  }

  private collectFacts(toolName: string, input: unknown, output: unknown): void {
    if (!isRecord(output)) return;

    if (toolName === "inspect_project") {
      const packageManager = stringValue(output.packageManager);
      if (packageManager) this.addFact(`Package manager: ${packageManager}`);

      const scripts = stringArray(output.scripts).slice(0, 20);
      if (scripts.length > 0) this.addFact(`Scripts: ${scripts.join(", ")}`);

      const deps = stringArray(output.keyDependencies).slice(0, 30);
      if (deps.length > 0) this.addFact(`Key dependencies: ${deps.join(", ")}`);

      const summary = stringValue(output.summary);
      if (summary) this.addFact(summary);

      const git = output.git;
      if (isRecord(git)) {
        const branch = stringValue(git.branch);
        if (branch) this.addFact(`Git branch: ${branch}`);
        const dirtyFileCount = numberValue(git.dirtyFileCount);
        if (dirtyFileCount !== undefined) {
          this.addFact(`Dirty files: ${dirtyFileCount}`);
        }
      }
    }

    if (toolName === "update_todos") {
      const todo = todoFromToolOutput(toolName, output);
      if (todo) this.addFact(`Todos: ${todo.summary}`);
    }

    if (toolName === "verify") {
      const verification = verificationFromToolOutput(toolName, output);
      if (verification) this.addFact(`Verification: ${verificationLine(verification)}`);
    }

    if (toolName === "read_file" && readPath(input) === "package.json") {
      const packageFacts = packageFactsFromContent(stringValue(output.content));
      for (const fact of packageFacts) this.addFact(fact);
    }

    const summary = stringValue(output.summary);
    if (summary && toolName !== "inspect_project") this.addFact(summary);
  }

  private collectCommand(
    toolName: string,
    input: unknown,
    output: unknown,
    error: string | undefined,
  ): void {
    if (toolName !== "bash" || !isRecord(input)) return;
    const command = stringValue(input.command);
    if (!command) return;
    const record = isRecord(output) ? output : {};
    const exitCode = outputExitCode(record) ?? null;
    const timedOut = booleanValue(record.timedOut);
    this.commands.push({
      command: truncate(command, 500),
      exitCode,
      ok: !error && exitCode === 0,
      timedOut,
      ...(error ? { error } : {}),
      ...textTailField("stdoutTail", stringValue(record.stdout)),
      ...textTailField("stderrTail", stringValue(record.stderr)),
    });
  }

  private addFact(value: string): void {
    const cleaned = compactLine(value, 500);
    if (cleaned) this.facts.add(cleaned);
  }

  private buildSummary(finalText: string | undefined): string {
    const lines: string[] = [`Run status: ${this.terminalStatus}.`];
    if (this.terminalError) {
      lines.push(`Run error: ${compactLine(this.terminalError, 500)}`);
    }
    if (finalText?.trim()) {
      lines.push(`Final answer: ${compactBlock(finalText, MAX_SUMMARY_CHARS)}`);
    }
    return compactBlock(lines.join("\n"), MAX_SUMMARY_CHARS);
  }
}

export function buildSessionContextDigest({
  sessionId,
  latestUserText,
  budgetChars = DEFAULT_CONTEXT_BUDGET_CHARS,
}: {
  sessionId: string;
  latestUserText: string;
  budgetChars?: number;
}): string | undefined {
  const summaries = listRunContextSummariesForSession(sessionId, 50);
  if (summaries.length === 0 || budgetChars <= 0) return undefined;

  const selected = selectSummaries(summaries, latestUserText);
  const blocks: string[] = [];
  let remaining = budgetChars;
  const header = [
    "Prior run context:",
    "Use this compact history for continuity. It may be stale; re-read files or rerun commands when exact current state matters.",
  ].join("\n");
  blocks.push(header);
  remaining -= header.length;

  for (const summary of selected) {
    const block = contextBlock(summary);
    if (block.length > remaining) {
      const truncated = truncate(block, Math.max(0, remaining - 32));
      if (truncated.trim()) blocks.push(`${truncated}\n...[context truncated]`);
      break;
    }
    blocks.push(block);
    remaining -= block.length;
    if (remaining <= 0) break;
  }

  return blocks.length > 1 ? blocks.join("\n\n") : undefined;
}

export function buildDroppedHistoryDigest(
  messages: AntonUIMessage[],
  maxChars = MAX_DROPPED_HISTORY_DIGEST_CHARS,
): string | undefined {
  if (messages.length === 0 || maxChars <= 0) return undefined;

  const digestLines = messages
    .flatMap(droppedMessageDigestLines)
    .filter(Boolean);
  if (digestLines.length === 0) return undefined;

  const header = "Dropped conversation context:";
  const selected: string[] = [];
  let remaining = maxChars - header.length - 1;

  for (let index = digestLines.length - 1; index >= 0; index -= 1) {
    if (remaining <= 0) break;
    const line = digestLines[index];
    const selectedLine =
      line.length > remaining ? truncate(line, remaining) : line;
    if (!selectedLine.trim()) break;
    selected.unshift(selectedLine);
    remaining -= selectedLine.length + 1;
    if (line.length > selectedLine.length) break;
  }

  if (selected.length === 0) return undefined;
  return compactBlock([header, ...selected].join("\n"), maxChars);
}

function droppedMessageDigestLines(message: AntonUIMessage): string[] {
  const text = messageTextSnippet(message);
  const tools = messageToolDigest(message);
  const lines: string[] = [];

  if (message.role === "user" && text) {
    lines.push(`- User: ${text}`);
  } else if (message.role === "assistant") {
    if (text) lines.push(`- Assistant: ${text}`);
    if (tools) lines.push(`- Tools: ${tools}`);
  }

  return lines;
}

function messageTextSnippet(message: AntonUIMessage): string {
  return compactBlock(
    message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n"),
    MAX_DROPPED_MESSAGE_TEXT_CHARS,
  );
}

function messageToolDigest(message: AntonUIMessage): string {
  const tools = message.parts.flatMap((part): string[] => {
    if (!isToolUIPart(part)) return [];
    const name = compactLine(getToolName(part), 100);
    if (!name) return [];
    const state =
      "state" in part && typeof part.state === "string"
        ? compactLine(part.state, 80)
        : "";
    return [state ? `${name} (${state})` : name];
  });

  return uniqueStrings(tools).slice(0, 12).join(", ");
}

function selectSummaries(
  summaries: RunContextSummary[],
  latestUserText: string,
): RunContextSummary[] {
  const recent = summaries.slice(0, RECENT_CONTEXT_COUNT);
  const recentIds = new Set(recent.map((summary) => summary.runId));
  const keywords = keywordsFor(latestUserText);
  const relevantOlder = summaries
    .slice(RECENT_CONTEXT_COUNT)
    .filter((summary) => {
      if (keywords.length === 0) return false;
      const haystack = searchableText(summary);
      return keywords.some((keyword) => haystack.includes(keyword));
    })
    .filter((summary) => !recentIds.has(summary.runId));
  return [...recent, ...relevantOlder];
}

function contextBlock(summary: RunContextSummary): string {
  const parts = [`Run ${summary.createdAt.toISOString()}:`];
  const tools = toolArray(summary.tools);
  const blockers = tools.flatMap((tool) => (tool.blocker ? [tool.blocker] : []));
  if (blockers.length > 0) {
    parts.push(`Blockers: ${blockers.slice(-3).map(blockerLine).join("; ")}`);
  }

  const verification = latestVerification(tools);
  if (verification) parts.push(`Verification: ${verificationLine(verification)}`);

  const todo = latestTodo(tools);
  if (todo) parts.push(`Todos: ${todoLine(todo)}`);

  const failedTools = tools
    .filter((tool) => tool.status === "error" && !tool.blocker)
    .slice(-5);
  if (failedTools.length > 0) {
    parts.push(`Failed tools: ${failedTools.map(failedToolLine).join("; ")}`);
  }

  const files = touchedFileArray(summary.files).slice(0, 10);
  if (files.length > 0) {
    parts.push(
      `Touched files: ${files
        .map((file) => `${file.action} ${file.path}`)
        .join("; ")}`,
    );
  }

  const commands = commandArray(summary.commands).slice(0, 5);
  if (commands.length > 0) {
    parts.push(
      `Commands: ${commands
        .map((command) => {
          const status =
            command.exitCode === null ? "no exit" : `exit ${command.exitCode}`;
          return `${command.command} (${status})`;
        })
        .join("; ")}`,
    );
  }

  const facts = stringArray(summary.facts).slice(0, 8);
  if (facts.length > 0) parts.push(`Facts: ${facts.join("; ")}`);

  parts.push(compactBlock(summary.summary, MAX_DIGEST_BLOCK_CHARS));
  return compactBlock(parts.join("\n"), MAX_DIGEST_BLOCK_CHARS);
}

function searchableText(summary: RunContextSummary): string {
  return [
    summary.summary,
    stableJson(summary.facts),
    stableJson(summary.files),
    stableJson(summary.commands),
    stableJson(summary.tools),
  ]
    .join("\n")
    .toLowerCase();
}

function keywordsFor(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);
  return Array.from(new Set(words)).slice(0, 30);
}

function packageFactsFromContent(content: string): string[] {
  if (!content.trim()) return [];
  const parsed = parseJsonObject(content);
  if (!parsed) return [];
  const dependencies = packageSectionNames(parsed.dependencies);
  const devDependencies = packageSectionNames(parsed.devDependencies);
  const packageManager = stringValue(parsed.packageManager);
  const facts: string[] = [];
  if (dependencies.length > 0) {
    facts.push(`Runtime dependencies: ${dependencies.slice(0, 40).join(", ")}`);
  }
  if (devDependencies.length > 0) {
    facts.push(`Dev dependencies: ${devDependencies.slice(0, 30).join(", ")}`);
  }
  if (packageManager) facts.push(`Package manager field: ${packageManager}`);
  return facts;
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function packageSectionNames(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return Object.keys(value).sort((left, right) => left.localeCompare(right));
}

function todoFromToolOutput(
  toolName: string,
  output: unknown,
): RunContextTodo | undefined {
  if (toolName !== "update_todos" || !isRecord(output) || output.ok !== true) {
    return undefined;
  }
  const items = todoItemArray(output.items);
  if (items.length === 0) return undefined;
  const completedCount =
    numberValue(output.completedCount) ??
    items.filter((item) => item.status === "completed").length;
  const current = items.find((item) => item.status === "in_progress")?.text;
  const summary =
    stringValue(output.summary) ||
    (current
      ? `${completedCount}/${items.length} complete; current: ${current}`
      : `${completedCount}/${items.length} complete`);
  return {
    summary: compactLine(summary, 500),
    itemCount: numberValue(output.itemCount) ?? items.length,
    completedCount,
    ...(current ? { current: compactLine(current, 240) } : {}),
    items: items.slice(0, 40),
  };
}

function todoItemArray(value: unknown): RunContextTodoItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RunContextTodoItem[] => {
    if (!isRecord(item)) return [];
    const text = compactLine(stringValue(item.text), 240);
    const status = item.status;
    if (
      !text ||
      (status !== "pending" &&
        status !== "in_progress" &&
        status !== "completed")
    ) {
      return [];
    }
    return [{ text, status }];
  });
}

function verificationFromToolOutput(
  toolName: string,
  output: unknown,
): RunContextVerification | undefined {
  if (toolName !== "verify" || !isRecord(output)) return undefined;
  const status = compactLine(stringValue(output.status), 100);
  if (!status) return undefined;
  return {
    status,
    ...optionalCompactString("summary", output.summary, 500),
    ...optionalCompactString("failureScope", output.failureScope, 100),
    ...optionalCompactString("failureSummary", output.failureSummary, 500),
    ...optionalCompactString("recommendedNext", output.recommendedNext, 200),
    editedPaths: stringArray(output.editedPaths).slice(0, 10),
    failedTargets: failedTargetsFromVerifyResults(output.results).slice(0, 5),
  };
}

function failedTargetsFromVerifyResults(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): string[] => {
    if (!isRecord(item) || item.ok !== false) return [];
    const target = compactLine(stringValue(item.target), 100);
    if (!target) return [];
    const exitCode = outputExitCode(item);
    return [exitCode === undefined ? target : `${target} exit ${exitCode}`];
  });
}

function touchedFilesFromTool(
  toolName: string,
  input: unknown,
  output: unknown,
  success: boolean,
): RunContextFile[] {
  if (!success || (isRecord(output) && output.ok === false)) return [];
  const action = touchedFileAction(toolName);
  if (!action) return [];
  const record = isRecord(output) ? output : isRecord(input) ? input : {};
  const files: RunContextFile[] = [];
  addTouchedPath(files, action, stringValue(record.path));
  if (toolName === "rename") {
    addTouchedPath(files, "renamed from", stringValue(record.sourcePath));
    addTouchedPath(files, "renamed to", stringValue(record.destinationPath));
  } else if (toolName === "copy") {
    addTouchedPath(files, "copied from", stringValue(record.sourcePath));
    addTouchedPath(files, "copied to", stringValue(record.destinationPath));
  } else {
    addTouchedPath(files, action, stringValue(record.targetPath));
    addTouchedPath(files, action, stringValue(record.destinationPath));
  }
  addTouchedPathList(files, action, record.paths);
  addTouchedPathList(files, action, record.restoredPaths);
  return uniqueFiles(files);
}

function touchedFileAction(toolName: string): string | undefined {
  switch (toolName) {
    case "edit_file":
    case "replace_text":
    case "replace_lines":
    case "edit_text":
    case "multi_replace_text":
      return "edited";
    case "write_file":
      return "created";
    case "format":
      return "formatted";
    case "mkdir":
      return "created";
    case "delete":
      return "deleted";
    case "rename":
      return "renamed";
    case "copy":
      return "copied";
    case "git_restore":
    case "revert_changes":
      return "restored";
    default:
      return undefined;
  }
}

function addTouchedPath(
  files: RunContextFile[],
  action: string,
  rawPath: string,
): void {
  const path = compactLine(rawPath, 500);
  if (path) files.push({ path, action });
}

function addTouchedPathList(
  files: RunContextFile[],
  action: string,
  value: unknown,
): void {
  for (const path of stringArray(value)) addTouchedPath(files, action, path);
}

function uniqueFiles(files: RunContextFile[]): RunContextFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.action}:${file.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readPath(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const path = stringValue(input.path).replace(/\\/g, "/");
  return path || undefined;
}

function toolError(
  success: boolean,
  output: unknown,
  error: unknown,
): string | undefined {
  const thrown = errorMessageOrUndefined(error);
  if (thrown) return compactLine(thrown, 500);
  if (!success) return "Tool execution failed";
  if (!isRecord(output)) return undefined;
  const outputError = stringValue(output.error);
  if (output.ok === false && outputError) return compactLine(outputError, 500);
  const failedReason = stringValue(output.failedReason);
  if (failedReason) return compactLine(failedReason, 500);
  const exitCode = outputExitCode(output);
  if (exitCode !== undefined && exitCode !== 0) return `exit ${exitCode}`;
  return undefined;
}

function commandArray(value: unknown): RunContextCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RunContextCommand[] => {
    if (!isRecord(item)) return [];
    const command = stringValue(item.command);
    if (!command) return [];
    return [
      {
        command,
        exitCode: outputExitCode(item) ?? null,
        ok: booleanValue(item.ok),
        timedOut: booleanValue(item.timedOut),
        ...optionalString("error", item.error),
        ...optionalString("stdoutTail", item.stdoutTail),
        ...optionalString("stderrTail", item.stderrTail),
      },
    ];
  });
}

function fileArray(value: unknown): RunContextFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RunContextFile[] => {
    if (!isRecord(item)) return [];
    const path = stringValue(item.path);
    const action = stringValue(item.action);
    return path && action ? [{ path, action }] : [];
  });
}

function touchedFileArray(value: unknown): RunContextFile[] {
  return fileArray(value).flatMap((file): RunContextFile[] => {
    const action = digestFileAction(file.action);
    return action ? [{ ...file, action }] : [];
  });
}

function digestFileAction(action: string): string | undefined {
  switch (action) {
    case "edited":
    case "wrote":
    case "formatted":
    case "created":
    case "deleted":
    case "renamed":
    case "renamed from":
    case "renamed to":
    case "copied":
    case "copied from":
    case "copied to":
    case "restored":
      return action;
    case "edit_file":
    case "replace_text":
    case "replace_lines":
    case "edit_text":
    case "multi_replace_text":
      return "edited";
    case "write_file":
      return "created";
    case "format":
      return "formatted";
    case "mkdir":
      return "created";
    case "delete":
      return "deleted";
    case "rename":
      return "renamed";
    case "copy":
      return "copied";
    case "git_restore":
    case "revert_changes":
      return "restored";
    default:
      return undefined;
  }
}

function toolArray(value: unknown): RunContextTool[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RunContextTool[] => {
    if (!isRecord(item)) return [];
    const name = stringValue(item.name);
    const status = item.status;
    if (!name || (status !== "completed" && status !== "error")) return [];
    const exitCode = outputExitCode(item);
    const tool: RunContextTool = {
      name,
      status,
      ...optionalString("input", item.input),
      ...optionalString("output", item.output),
      ...(exitCode !== undefined ? { exitCode } : {}),
      ...optionalString("error", item.error),
    };
    const todo = todoValue(item.todo);
    if (todo) tool.todo = todo;
    const verification = verificationValue(item.verification);
    if (verification) tool.verification = verification;
    const blocker = blockerValue(item.blocker);
    if (blocker) tool.blocker = blocker;
    const touchedFiles = fileArray(item.touchedFiles);
    if (touchedFiles.length > 0) tool.touchedFiles = touchedFiles;
    return [tool];
  });
}

function todoValue(value: unknown): RunContextTodo | undefined {
  if (!isRecord(value)) return undefined;
  const summary = compactLine(stringValue(value.summary), 500);
  const items = todoItemArray(value.items);
  const itemCount = numberValue(value.itemCount) ?? items.length;
  const completedCount =
    numberValue(value.completedCount) ??
    items.filter((item) => item.status === "completed").length;
  if (!summary || itemCount <= 0) return undefined;
  const current = compactLine(stringValue(value.current), 240);
  return {
    summary,
    itemCount,
    completedCount,
    ...(current ? { current } : {}),
    items,
  };
}

function verificationValue(
  value: unknown,
): RunContextVerification | undefined {
  if (!isRecord(value)) return undefined;
  const status = compactLine(stringValue(value.status), 100);
  if (!status) return undefined;
  return {
    status,
    ...optionalCompactString("summary", value.summary, 500),
    ...optionalCompactString("failureScope", value.failureScope, 100),
    ...optionalCompactString("failureSummary", value.failureSummary, 500),
    ...optionalCompactString("recommendedNext", value.recommendedNext, 200),
    editedPaths: stringArray(value.editedPaths).slice(0, 10),
    failedTargets: stringArray(value.failedTargets).slice(0, 5),
  };
}

function blockerValue(value: unknown): RunContextBlocker | undefined {
  if (!isRecord(value)) return undefined;
  const reason = compactLine(stringValue(value.reason), 500);
  if (!reason) return undefined;
  return {
    reason,
    blockedTools: stringArray(value.blockedTools).slice(0, 20),
    forceFinal: booleanValue(value.forceFinal),
    ...optionalCompactString("affectedPath", value.affectedPath, 500),
    ...optionalCompactString("phase", value.phase, 100),
    ...optionalCompactString("failureCode", value.failureCode, 100),
    ...optionalCompactString("recommendedNext", value.recommendedNext, 300),
  };
}

function latestTodo(tools: RunContextTool[]): RunContextTodo | undefined {
  return tools.findLast((tool) => tool.todo)?.todo;
}

function latestVerification(
  tools: RunContextTool[],
): RunContextVerification | undefined {
  return tools.findLast((tool) => tool.verification)?.verification;
}

function todoLine(todo: RunContextTodo): string {
  if (todo.current && !todo.summary.includes("current:")) {
    return `${todo.summary}; current: ${todo.current}`;
  }
  return todo.summary;
}

function verificationLine(verification: RunContextVerification): string {
  return [
    verification.status,
    verification.failureScope ? `scope ${verification.failureScope}` : "",
    verification.summary ?? "",
    verification.failureSummary
      ? `failure ${verification.failureSummary}`
      : "",
    verification.failedTargets.length > 0
      ? `failed targets ${verification.failedTargets.join(", ")}`
      : "",
    verification.editedPaths.length > 0
      ? `edited ${verification.editedPaths.join(", ")}`
      : "",
    verification.recommendedNext ? `next ${verification.recommendedNext}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function blockerLine(blocker: RunContextBlocker): string {
  return [
    blocker.reason,
    blocker.blockedTools.length > 0
      ? `blocked ${blocker.blockedTools.join(", ")}`
      : "",
    blocker.affectedPath ? `path ${blocker.affectedPath}` : "",
    blocker.phase ? `phase ${blocker.phase}` : "",
    blocker.failureCode ? `code ${blocker.failureCode}` : "",
    blocker.recommendedNext ? `next ${blocker.recommendedNext}` : "",
    blocker.forceFinal ? "final required" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function failedToolLine(tool: RunContextTool): string {
  const reason = tool.error ?? tool.output ?? "failed";
  return `${tool.name}: ${compactLine(reason, 300)}`;
}

function textTailField<K extends "stdoutTail" | "stderrTail">(
  key: K,
  value: string,
): Partial<Record<K, string>> {
  if (!value.trim()) return {};
  return { [key]: tail(compactBlock(value, MAX_TEXT_FIELD_CHARS), MAX_TEXT_FIELD_CHARS) } as Partial<
    Record<K, string>
  >;
}

function optionalString<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  const text = stringValue(value);
  return text ? ({ [key]: text } as Partial<Record<K, string>>) : {};
}

function optionalCompactString<K extends string>(
  key: K,
  value: unknown,
  maxLength: number,
): Partial<Record<K, string>> {
  const text = compactLine(stringValue(value), maxLength);
  return text ? ({ [key]: text } as Partial<Record<K, string>>) : {};
}

function compactLine(value: string, maxLength = 500): string {
  return truncate(redactText(value).replace(/\s+/g, " ").trim(), maxLength);
}

function compactBlock(value: string, maxLength: number): string {
  return truncate(redactText(value).replace(/\r\n/g, "\n").trim(), maxLength);
}

function truncate(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function tail(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(value.length - maxLength);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => compactLine(item, 500))
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessageOrUndefined(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (error instanceof Error) return error.message;
  return String(error);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
