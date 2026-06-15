import type { AgentRunProfile } from "../loop";

export const READ_FILE_MODEL_MAX_LINES = 400;
export const READ_FILE_MODEL_MAX_CHARS = 24_000;
export const READ_FILE_LOCALIZED_FULL_MAX_LINES = 600;
export const READ_FILE_LOCALIZED_FULL_MAX_CHARS = 40_000;
export const READ_FILE_LOCALIZED_RANGE_MAX_LINES = 200;
export const READ_FILE_LOCALIZED_RANGE_MAX_CHARS = 12_000;
export const GREP_MODEL_MAX_MATCHES = 30;
export const GREP_MODEL_MAX_MATCH_CHARS = 220;
export const GLOB_MODEL_MAX_PATHS = 80;
export const VERIFY_MODEL_OUTPUT_TAIL_CHARS = 1_200;

export type ModelVisibleToolOutput = {
  ok: boolean;
  code: string;
  summary: string;
  recommendedNext?: string;
  pathHints?: unknown;
  details?: unknown;
} & Record<string, unknown>;

export function modelVisibleToolOutput(
  output: unknown,
  defaults: {
    successCode: string;
    failureCode: string;
    successSummary: string;
    failureSummary: string;
    successRecommendedNext?: string;
    failureRecommendedNext?: string;
    pathHints?: unknown;
    details?: unknown;
  },
): ModelVisibleToolOutput {
  const record = isRecord(output) ? output : {};
  const ok = record.ok === true;
  const code =
    typeof record.code === "string" && record.code.length > 0
      ? record.code
      : ok
        ? defaults.successCode
        : defaults.failureCode;
  const summary =
    firstString(record.summary, record.message, record.error) ??
    (ok ? defaults.successSummary : defaults.failureSummary);
  const recommendedNext =
    firstString(record.recommendedNext) ??
    (ok
      ? defaults.successRecommendedNext
      : defaults.failureRecommendedNext);
  const pathHints =
    record.pathHints ?? pathHintFromRecord(record) ?? defaults.pathHints;
  return {
    ...record,
    ok,
    code,
    summary,
    ...(recommendedNext ? { recommendedNext } : {}),
    ...(pathHints !== undefined ? { pathHints } : {}),
    ...(record.details !== undefined
      ? { details: record.details }
      : defaults.details !== undefined
        ? { details: defaults.details }
        : {}),
  };
}

export function readFileOutputIsFullCoverage(output: Record<string, unknown>): boolean {
  if (output.truncated === true) return false;
  const startLine = finiteNumber(output.startLine) ?? 1;
  const endLine = finiteNumber(output.endLine);
  const totalLines = finiteNumber(output.totalLines);
  if (endLine === undefined || totalLines === undefined) return false;
  return startLine <= 1 && endLine >= totalLines;
}

export function readFileOutputIsModestFullFile(
  output: Record<string, unknown>,
): boolean {
  if (!readFileOutputIsFullCoverage(output)) return false;
  const totalLines = finiteNumber(output.totalLines) ?? 0;
  const sizeBytes =
    finiteNumber(output.sizeBytes) ??
    (typeof output.content === "string"
      ? Buffer.byteLength(output.content, "utf8")
      : 0);
  return (
    totalLines <= READ_FILE_LOCALIZED_FULL_MAX_LINES &&
    sizeBytes <= READ_FILE_LOCALIZED_FULL_MAX_CHARS
  );
}

export function compactReadFileForModel(
  output: unknown,
  profile: AgentRunProfile = "general-chat",
): unknown {
  if (!isRecord(output) || output.ok !== true) {
    return modelVisibleToolOutput(output, {
      successCode: "READ_FILE_OK",
      failureCode: "READ_FILE_FAILED",
      successSummary: "File read successfully.",
      failureSummary: "File could not be read.",
      failureRecommendedNext: "Check the path and read a nearby directory if needed.",
    });
  }
  const content = typeof output.content === "string" ? output.content : "";

  if (readFileOutputIsModestFullFile(output)) {
    return modelVisibleToolOutput({
      ok: true,
      path: output.path,
      startLine: output.startLine,
      endLine: output.endLine,
      totalLines: output.totalLines,
      sizeBytes: output.sizeBytes,
      sha256: output.sha256,
      content,
    }, {
      successCode: "READ_FILE_OK",
      failureCode: "READ_FILE_FAILED",
      successSummary: `Read ${stringValue(output.path) || "file"}.`,
      failureSummary: "File could not be read.",
      successRecommendedNext: "Continue with the visible file content.",
    });
  }

  const lines = content.split("\n");
  const maxLines =
    profile === "localized-edit"
      ? READ_FILE_LOCALIZED_RANGE_MAX_LINES
      : READ_FILE_MODEL_MAX_LINES;
  const maxChars =
    profile === "localized-edit"
      ? READ_FILE_LOCALIZED_RANGE_MAX_CHARS
      : READ_FILE_MODEL_MAX_CHARS;
  const trimmedLines =
    lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  let compactContent = trimmedLines.join("\n");
  let truncated = lines.length > maxLines || output.truncated === true;
  if (compactContent.length > maxChars) {
    compactContent = compactContent.slice(0, maxChars);
    truncated = true;
  }
  const hasMoreBefore =
    output.hasMoreBefore === true || (finiteNumber(output.startLine) ?? 1) > 1;
  const hasMoreAfter =
    output.hasMoreAfter === true ||
    (finiteNumber(output.endLine) !== undefined &&
      finiteNumber(output.totalLines) !== undefined &&
      (finiteNumber(output.endLine) as number) <
        (finiteNumber(output.totalLines) as number));
  return modelVisibleToolOutput({
    ok: true,
    path: output.path,
    startLine: output.startLine,
    endLine: output.endLine,
    totalLines: output.totalLines,
    sizeBytes: output.sizeBytes,
    sha256: output.sha256,
    ...(truncated
      ? {
          truncated: true as const,
          modelVisibleLines: trimmedLines.length,
          ...(hasMoreBefore ? { hasMoreBefore: true as const } : {}),
          ...(hasMoreAfter ? { hasMoreAfter: true as const } : {}),
          ...(finiteNumber(output.nextStartLine) !== undefined
            ? { nextStartLine: output.nextStartLine }
            : {}),
          ...(finiteNumber(output.nextEndLine) !== undefined
            ? { nextEndLine: output.nextEndLine }
            : {}),
        }
      : {}),
    content: compactContent,
  }, {
    successCode: "READ_FILE_OK",
    failureCode: "READ_FILE_FAILED",
    successSummary: `Read ${stringValue(output.path) || "file"}${truncated ? " with truncation" : ""}.`,
    failureSummary: "File could not be read.",
    successRecommendedNext: truncated
      ? "Request a narrower line range before editing unseen content."
      : "Continue with the visible file content.",
  });
}

export function compactGrepForModel(output: unknown): unknown {
  if (!isRecord(output) || output.ok !== true || !Array.isArray(output.matches)) {
    return modelVisibleToolOutput(output, {
      successCode: "GREP_OK",
      failureCode: "GREP_FAILED",
      successSummary: "Search completed.",
      failureSummary: "Search could not be completed.",
      failureRecommendedNext: "Fix the pattern or path, then search again.",
    });
  }
  const matches = output.matches.slice(0, GREP_MODEL_MAX_MATCHES).map((match) => {
    if (!isRecord(match)) return match;
    const text = typeof match.text === "string" ? match.text : "";
    return {
      ...match,
      text:
        text.length > GREP_MODEL_MAX_MATCH_CHARS
          ? `${text.slice(0, GREP_MODEL_MAX_MATCH_CHARS)}…`
          : text,
    };
  });
  return modelVisibleToolOutput({
    ...output,
    matches,
    matchCount: matches.length,
    truncated:
      output.truncated === true ||
      (Array.isArray(output.matches) &&
        output.matches.length > GREP_MODEL_MAX_MATCHES),
  }, {
    successCode: "GREP_OK",
    failureCode: "GREP_FAILED",
    successSummary: `Found ${matches.length} matching line${matches.length === 1 ? "" : "s"}.`,
    failureSummary: "Search could not be completed.",
    successRecommendedNext: matches.length > 0
      ? "Inspect the most relevant match with read_file."
      : "Try a broader pattern if needed.",
  });
}

export function compactGlobForModel(output: unknown): unknown {
  if (!isRecord(output) || output.ok !== true || !Array.isArray(output.matches)) {
    return modelVisibleToolOutput(output, {
      successCode: "GLOB_OK",
      failureCode: "GLOB_FAILED",
      successSummary: "Glob completed.",
      failureSummary: "Glob could not be completed.",
      failureRecommendedNext: "Check the base path or simplify the glob pattern.",
    });
  }
  const matches = output.matches.slice(0, GLOB_MODEL_MAX_PATHS);
  return modelVisibleToolOutput({
    ...output,
    matches,
    matchCount: matches.length,
    truncated:
      output.truncated === true ||
      output.matches.length > GLOB_MODEL_MAX_PATHS,
  }, {
    successCode: "GLOB_OK",
    failureCode: "GLOB_FAILED",
    successSummary: `Found ${matches.length} path${matches.length === 1 ? "" : "s"}.`,
    failureSummary: "Glob could not be completed.",
    successRecommendedNext: matches.length > 0
      ? "Read or inspect the relevant paths."
      : "Try a broader pattern if needed.",
  });
}

export function compactVerifyForModel(output: unknown): unknown {
  if (!isRecord(output)) {
    return modelVisibleToolOutput(output, {
      successCode: "VERIFY_OK",
      failureCode: "VERIFY_FAILED",
      successSummary: "Verification completed.",
      failureSummary: "Verification failed.",
      failureRecommendedNext: "Inspect verification output and decide whether to fix or report.",
    });
  }
  const results = Array.isArray(output.results)
    ? output.results.map(compactVerifyResultForModel)
    : output.results;
  const failed = Array.isArray(results)
    ? results.find(isVerifyExecutionFailure)
    : undefined;
  const failureSummary = extractVerifyFailureSummary(output);
  const base = {
    ok: output.ok,
    status: output.status,
    strategy: output.strategy,
    stoppedOnFailure: output.stoppedOnFailure,
    firstFailedTarget: output.firstFailedTarget,
    notRunCount: output.notRunCount,
    failureScope: output.failureScope,
    recommendedNext: output.recommendedNext,
    summary: output.summary,
    packageManager: output.packageManager,
    ranCount: output.ranCount,
    skippedCount: output.skippedCount,
    editedPaths: Array.isArray(output.editedPaths)
      ? output.editedPaths.slice(0, 10)
      : output.editedPaths,
    pathHints: Array.isArray(output.pathHints)
      ? output.pathHints.slice(0, 5)
      : output.pathHints,
    ...(failureSummary ? { failureSummary } : {}),
  };
  const parseIssues =
    failed && isRecord(failed)
      ? extractParseIssuesFromText(
          [failed.stderr, failed.stdout, failed.error]
            .filter((value): value is string => typeof value === "string")
            .join("\n"),
        )
      : [];

  if (output.ok === false) {
    return modelVisibleToolOutput({
      ...base,
      ok: false,
      ...(parseIssues.length > 0 ? { parseIssues: parseIssues.slice(0, 5) } : {}),
      ...(failed && isRecord(failed)
        ? {
            failedTarget: output.firstFailedTarget ?? failed.target,
            failedCommand: failed.command,
            timedOut: failed.timedOut,
            timeoutMs: failed.timeoutMs,
            exitCode: failed.exitCode,
          }
        : {}),
    }, {
      successCode: "VERIFY_OK",
      failureCode: "VERIFY_FAILED",
      successSummary: "Verification completed.",
      failureSummary: failureSummary ?? "Verification failed.",
      failureRecommendedNext: "Fix edited-file failures; report unrelated or broken verification.",
    });
  }

  return modelVisibleToolOutput({
    ...base,
    results,
  }, {
    successCode: "VERIFY_OK",
    failureCode: "VERIFY_FAILED",
    successSummary: typeof output.summary === "string"
      ? output.summary
      : "Verification completed.",
    failureSummary: "Verification failed.",
    successRecommendedNext:
      output.recommendedNext === "final" ? "final" : undefined,
  });
}

export function extractVerifyFailureSummary(output: unknown): string | undefined {
  if (!isRecord(output)) return undefined;
  if (
    typeof output.failureSummary === "string" &&
    output.failureSummary.trim().length > 0
  ) {
    return output.failureSummary.trim();
  }
  if (typeof output.summary === "string" && output.summary.trim().length > 0) {
    const base = output.summary.trim();
    if (!Array.isArray(output.results)) return base;
    const failed = output.results.find(isVerifyExecutionFailure);
    if (!isRecord(failed)) return base;
    const text = [failed.stderr, failed.stdout, failed.error, failed.message]
      .filter((value): value is string => typeof value === "string")
      .join("\n");
    const issues = extractParseIssuesFromText(text);
    if (issues.length > 0) {
      const primary = issues[0];
      const loc =
        primary.line !== undefined
          ? ` at line ${primary.line}${primary.column !== undefined ? `:${primary.column}` : ""}`
          : "";
      return `${base} — ${primary.message}${loc}`;
    }
    if (typeof failed.error === "string" && failed.error.trim().length > 0) {
      return `${base} — ${failed.error.trim().slice(0, 200)}`;
    }
    return base;
  }
  return undefined;
}

export function extractParseIssuesFromText(
  text: string,
): { line?: number; column?: number; message: string }[] {
  const issues: { line?: number; column?: number; message: string }[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const unix = trimmed.match(
      /^(?:.*[\\/])?([^:]+):(\d+):(\d+):\s*(.+?)(?:\s+\[(.+)\])?$/,
    );
    if (unix) {
      const [, , lineText, columnText, message] = unix;
      issues.push({
        line: Number.parseInt(lineText, 10),
        column: Number.parseInt(columnText, 10),
        message: message.trim(),
      });
      continue;
    }
    const parsing = trimmed.match(/Parsing error:\s*(.+)$/i);
    if (parsing) {
      const lineMatch = trimmed.match(/:(\d+):(\d+)/);
      issues.push({
        ...(lineMatch
          ? {
              line: Number.parseInt(lineMatch[1], 10),
              column: Number.parseInt(lineMatch[2], 10),
            }
          : {}),
        message: `Parsing error: ${parsing[1].trim()}`,
      });
    }
  }
  return issues;
}

function compactVerifyResultForModel(result: unknown): unknown {
  if (!isRecord(result)) return result;
  const status = typeof result.status === "string" ? result.status : undefined;
  const notRun = status === "not_run" || result.notRun === true;
  return {
    target: result.target,
    ...(status ? { status } : {}),
    skipped: result.skipped,
    ok: result.ok,
    ...(notRun
      ? {
          notRun: true as const,
          reason: result.reason,
        }
      : result.skipped
      ? { reason: result.reason }
      : {
          command: result.command,
          timeoutMs: result.timeoutMs,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: tailText(result.stdout),
          stderr: tailText(result.stderr),
          ...(result.ok === false ? { error: result.error } : {}),
        }),
  };
}

function isVerifyExecutionFailure(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.ok === false &&
    value.skipped !== true &&
    value.notRun !== true &&
    value.status !== "not_run"
  );
}

function tailText(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (value.length <= VERIFY_MODEL_OUTPUT_TAIL_CHARS) return value;
  return value.slice(-VERIFY_MODEL_OUTPUT_TAIL_CHARS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pathHintFromRecord(record: Record<string, unknown>): unknown {
  if (typeof record.path === "string" && record.path.length > 0) {
    return [record.path];
  }
  if (typeof record.file === "string" && record.file.length > 0) {
    return [record.file];
  }
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export type VerifyToolDefaults = {
  targets?: readonly ("typecheck" | "lint" | "build")[];
  timeoutMs: number;
};

export function readFileDefaultMaxLines(profile: AgentRunProfile): number {
  return profile === "localized-edit" || profile === "single-file-edit"
    ? READ_FILE_LOCALIZED_FULL_MAX_LINES
    : READ_FILE_MODEL_MAX_LINES;
}

export function readFileReturnsFullByDefault(
  profile: AgentRunProfile,
  totalLines: number,
  sizeBytes: number,
): boolean {
  return (
    (profile === "localized-edit" || profile === "single-file-edit") &&
    totalLines <= READ_FILE_LOCALIZED_FULL_MAX_LINES &&
    sizeBytes <= READ_FILE_LOCALIZED_FULL_MAX_CHARS
  );
}

export function verifyDefaultsForProfile(
  profile: AgentRunProfile,
): VerifyToolDefaults {
  if (profile === "localized-edit" || profile === "single-file-edit") {
    return {
      targets: ["typecheck", "lint"],
      timeoutMs: 60_000,
    };
  }
  return {
    targets: ["typecheck", "lint"],
    timeoutMs: 120_000,
  };
}
