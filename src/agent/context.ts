import type { RunContextSummary } from "@/src/db/schema";
import {
  listRunContextSummariesForSession,
  upsertRunContextSummary,
} from "@/src/db/queries";
import { redactText } from "@/src/lib/redaction";

const RECENT_CONTEXT_COUNT = 5;
const DEFAULT_CONTEXT_BUDGET_CHARS = 6_000;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_TEXT_FIELD_CHARS = 1_200;
const MAX_DIGEST_BLOCK_CHARS = 1_500;

export type RunContextStatus = "completed" | "error" | "aborted";

type RunContextFile = {
  path: string;
  action: string;
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

type RunContextTool = {
  name: string;
  status: "completed" | "error";
  input?: string;
  output?: string;
  exitCode?: number | null;
  error?: string;
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
    const inputSummary = summarizeInput(event.input);
    const outputSummary = summarizeOutput(event.output, event.error);
    const exitCode = outputExitCode(event.output);

    this.tools.push({
      name: event.toolName,
      status,
      ...(inputSummary ? { input: inputSummary } : {}),
      ...(outputSummary ? { output: outputSummary } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}),
      ...(error ? { error } : {}),
    });

    this.collectFacts(event.toolName, event.input, event.output);
    this.collectFiles(event.toolName, event.input);
    this.collectCommand(event.toolName, event.input, event.output, error);
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

    if (toolName === "read_file" && readPath(input) === "package.json") {
      const packageFacts = packageFactsFromContent(stringValue(output.content));
      for (const fact of packageFacts) this.addFact(fact);
    }

    const summary = stringValue(output.summary);
    if (summary && toolName !== "inspect_project") this.addFact(summary);
  }

  private collectFiles(toolName: string, input: unknown): void {
    if (!isRecord(input)) return;
    for (const key of ["path", "sourcePath", "targetPath", "destinationPath"]) {
      const path = stringValue(input[key]);
      if (!path) continue;
      this.files.set(`${toolName}:${path}`, {
        path,
        action: toolName,
      });
    }
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
    const facts = Array.from(this.facts).slice(0, 8);
    if (facts.length > 0) lines.push(`Facts: ${facts.join("; ")}`);
    if (this.commands.length > 0) {
      lines.push(
        `Commands: ${this.commands
          .slice(-5)
          .map((command) => {
            const status =
              command.exitCode === null ? "no exit" : `exit ${command.exitCode}`;
            return `${command.command} (${status})`;
          })
          .join("; ")}`,
      );
    }
    if (this.files.size > 0) {
      lines.push(
        `Files: ${Array.from(this.files.values())
          .slice(-12)
          .map((file) => `${file.action} ${file.path}`)
          .join("; ")}`,
      );
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
  const parts = [
    `Run ${summary.createdAt.toISOString()}:`,
    compactBlock(summary.summary, MAX_DIGEST_BLOCK_CHARS),
  ];
  const facts = stringArray(summary.facts).slice(0, 8);
  if (facts.length > 0) parts.push(`Facts: ${facts.join("; ")}`);
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
  const files = fileArray(summary.files).slice(0, 10);
  if (files.length > 0) {
    parts.push(
      `Files: ${files.map((file) => `${file.action} ${file.path}`).join("; ")}`,
    );
  }
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

function readPath(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const path = stringValue(input.path).replace(/\\/g, "/");
  return path || undefined;
}

function summarizeInput(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  for (const key of ["command", "path", "sourcePath", "pattern", "slug", "task"]) {
    const value = stringValue(input[key]);
    if (value) return compactLine(value, 500);
  }
  return undefined;
}

function summarizeOutput(output: unknown, error: unknown): string | undefined {
  const message = errorMessageOrUndefined(error);
  if (message) return compactLine(message, 500);
  if (!isRecord(output)) return undefined;
  for (const key of ["error", "failedReason", "path", "summary", "stdout"]) {
    const value = stringValue(output[key]);
    if (value) return compactLine(value, 500);
  }
  const exitCode = outputExitCode(output);
  return exitCode !== undefined ? `exit ${exitCode}` : undefined;
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

function outputExitCode(output: unknown): number | undefined {
  if (!isRecord(output)) return undefined;
  const exitCode = output.exitCode;
  return typeof exitCode === "number" && Number.isInteger(exitCode)
    ? exitCode
    : undefined;
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

function compactLine(value: string, maxLength: number): string {
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
