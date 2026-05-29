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
  if (!isRecord(output) || output.ok !== true) return output;
  const content = typeof output.content === "string" ? output.content : "";

  if (readFileOutputIsModestFullFile(output)) {
    return {
      ok: true,
      path: output.path,
      startLine: output.startLine,
      endLine: output.endLine,
      totalLines: output.totalLines,
      sizeBytes: output.sizeBytes,
      sha256: output.sha256,
      content,
    };
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
  return {
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
  };
}

export function compactGrepForModel(output: unknown): unknown {
  if (!isRecord(output) || output.ok !== true || !Array.isArray(output.matches)) {
    return output;
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
  return {
    ...output,
    matches,
    matchCount: matches.length,
    truncated:
      output.truncated === true ||
      (Array.isArray(output.matches) &&
        output.matches.length > GREP_MODEL_MAX_MATCHES),
  };
}

export function compactGlobForModel(output: unknown): unknown {
  if (!isRecord(output) || output.ok !== true || !Array.isArray(output.matches)) {
    return output;
  }
  const matches = output.matches.slice(0, GLOB_MODEL_MAX_PATHS);
  return {
    ...output,
    matches,
    matchCount: matches.length,
    truncated:
      output.truncated === true ||
      output.matches.length > GLOB_MODEL_MAX_PATHS,
  };
}

export function compactVerifyForModel(output: unknown): unknown {
  if (!isRecord(output)) return output;
  const results = Array.isArray(output.results)
    ? output.results.map(compactVerifyResultForModel)
    : output.results;
  const failed = Array.isArray(results)
    ? results.find((result) => isRecord(result) && result.ok === false)
    : undefined;
  const failureSummary = extractVerifyFailureSummary(output);
  const parseIssues =
    failed && isRecord(failed)
      ? extractParseIssuesFromText(
          [failed.stderr, failed.stdout, failed.error]
            .filter((value): value is string => typeof value === "string")
            .join("\n"),
        )
      : [];

  if (output.ok === false) {
    return {
      ok: false,
      summary: output.summary,
      packageManager: output.packageManager,
      parallel: output.parallel,
      ranCount: output.ranCount,
      skippedCount: output.skippedCount,
      ...(failureSummary ? { failureSummary } : {}),
      ...(parseIssues.length > 0 ? { parseIssues: parseIssues.slice(0, 5) } : {}),
      ...(failed && isRecord(failed)
        ? {
            failedTarget: failed.target,
            failedCommand: failed.command,
            timedOut: failed.timedOut,
            timeoutMs: failed.timeoutMs,
            exitCode: failed.exitCode,
          }
        : {}),
    };
  }

  return {
    ok: output.ok,
    summary: output.summary,
    packageManager: output.packageManager,
    parallel: output.parallel,
    ranCount: output.ranCount,
    skippedCount: output.skippedCount,
    results,
  };
}

export function extractVerifyFailureSummary(output: unknown): string | undefined {
  if (!isRecord(output)) return undefined;
  if (typeof output.summary === "string" && output.summary.trim().length > 0) {
    const base = output.summary.trim();
    if (!Array.isArray(output.results)) return base;
    const failed = output.results.find(
      (result) => isRecord(result) && result.ok === false && result.skipped !== true,
    );
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
  return {
    target: result.target,
    skipped: result.skipped,
    ok: result.ok,
    ...(result.skipped
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

function tailText(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (value.length <= VERIFY_MODEL_OUTPUT_TAIL_CHARS) return value;
  return value.slice(-VERIFY_MODEL_OUTPUT_TAIL_CHARS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
