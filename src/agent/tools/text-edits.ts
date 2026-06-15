export type TextEdit = {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
};

export type ApplyTextEditsResult =
  | {
      ok: true;
      content: string;
      appliedCount: number;
      recoveredEditCount: number;
      matchedLineRanges: MatchedLineRange[];
    }
  | {
      ok: false;
      index: number;
      code: TextReplacementFailureCode;
      message: string;
    };

export type TextReplacementStrategy = "exact" | "indentation";

export type TextReplacementFailureCode =
  | "FIND_NOT_FOUND"
  | "FIND_NOT_UNIQUE"
  | "WRITE_FAILED";

export type MatchedLineRange = {
  startLine: number;
  endLine: number;
  strategy: "indentation";
};

export type PlanTextReplacementResult =
  | {
      ok: true;
      content: string;
      strategy: TextReplacementStrategy;
      replacementCount: number;
      matchedLineRange?: MatchedLineRange;
    }
  | {
      ok: false;
      code: TextReplacementFailureCode;
      message: string;
    };

type RecoveryDisabledReason = "guarded" | "replaceAll";

const MODEL_DIFF_MAX_CHARS = 4_000;

export function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  if (ending === "\n") return text;
  return text.replace(/\n/g, "\r\n");
}

export function applyTextEditsToContent(
  source: string,
  edits: readonly TextEdit[],
  options: {
    allowIndentationRecovery?: boolean;
    maxBytes?: number;
    recoveryDisabledReason?: RecoveryDisabledReason;
  } = {},
): ApplyTextEditsResult {
  const lineEnding = detectLineEnding(source);
  let content = normalizeToLF(source);
  let appliedCount = 0;
  let recoveredEditCount = 0;
  const matchedLineRanges: MatchedLineRange[] = [];

  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    const normalizedOld = normalizeToLF(edit.oldText);
    const normalizedNew = normalizeToLF(edit.newText);
    if (normalizedOld === normalizedNew) continue;

    const applied = planTextReplacement({
      content,
      find: normalizedOld,
      replace: normalizedNew,
      replaceAll: edit.replaceAll,
      allowIndentationRecovery: options.allowIndentationRecovery,
      maxBytes: options.maxBytes,
      recoveryDisabledReason:
        edit.replaceAll === true
          ? "replaceAll"
          : options.recoveryDisabledReason,
    });
    if (!applied.ok) {
      return {
        ok: false,
        index,
        code: applied.code,
        message: formatEditFailureMessage(
          applied.message,
          lineEnding,
          edit.oldText,
        ),
      };
    }
    content = applied.content;
    appliedCount += applied.replacementCount;
    if (applied.strategy === "indentation") {
      recoveredEditCount += 1;
      if (applied.matchedLineRange) {
        matchedLineRanges.push(applied.matchedLineRange);
      }
    }
  }

  return {
    ok: true,
    content: restoreLineEndings(content, lineEnding),
    appliedCount,
    recoveredEditCount,
    matchedLineRanges,
  };
}

function formatEditFailureMessage(
  baseMessage: string,
  fileLineEnding: "\r\n" | "\n",
  oldText: string,
): string {
  if (
    fileLineEnding === "\r\n" &&
    !oldText.includes("\r\n") &&
    oldText.includes("\n")
  ) {
    return `${baseMessage}; line endings were normalized, so CRLF vs LF is not the cause`;
  }
  return baseMessage;
}

export function planTextReplacement({
  content,
  find,
  replace,
  replaceAll = false,
  allowIndentationRecovery = false,
  maxBytes,
  recoveryDisabledReason,
}: {
  content: string;
  find: string;
  replace: string;
  replaceAll?: boolean;
  allowIndentationRecovery?: boolean;
  maxBytes?: number;
  recoveryDisabledReason?: RecoveryDisabledReason;
}): PlanTextReplacementResult {
  if (find.length === 0) {
    return {
      ok: false,
      code: "FIND_NOT_FOUND",
      message: "find text is empty; re-read the relevant range and retry with current text",
    };
  }

  const occurrences = countOccurrences(content, find);
  if (occurrences === 0) {
    if (replaceAll) {
      return {
        ok: false,
        code: "FIND_NOT_FOUND",
        message:
          "find text did not match file content exactly; replaceAll does not use indentation recovery",
      };
    }
    if (!allowIndentationRecovery) {
      return {
        ok: false,
        code: "FIND_NOT_FOUND",
        message: recoveryDisabledMessage(recoveryDisabledReason),
      };
    }
    return planIndentationReplacement({ content, find, replace, maxBytes });
  }

  if (!replaceAll && occurrences > 1) {
    return {
      ok: false,
      code: "FIND_NOT_UNIQUE",
      message: `find text occurs ${occurrences} times; include more surrounding context or use replace_lines`,
    };
  }

  const next = replaceAll
    ? content.split(find).join(replace)
    : content.replace(find, replace);
  return {
    ok: true,
    content: next,
    strategy: "exact",
    replacementCount: replaceAll ? occurrences : 1,
  };
}

function planIndentationReplacement({
  content,
  find,
  replace,
  maxBytes,
}: {
  content: string;
  find: string;
  replace: string;
  maxBytes: number | undefined;
}): PlanTextReplacementResult {
  const matches = indentationEquivalentMatches(content, find);
  if (matches.length === 0) {
    return {
      ok: false,
      code: "FIND_NOT_FOUND",
      message:
        "find text did not match exactly and no unique indentation-only candidate was found; re-read the relevant range and retry with current text",
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      code: "FIND_NOT_UNIQUE",
      message: `find text did not match exactly and ${matches.length} trim-equivalent candidates were found; include more surrounding context or use replace_lines`,
    };
  }

  const [match] = matches;
  if (!match) {
    return {
      ok: false,
      code: "FIND_NOT_FOUND",
      message:
        "find text did not match exactly and no unique indentation-only candidate was found; re-read the relevant range and retry with current text",
    };
  }

  const replacement = indentationRecoveredReplacement({
    findLines: match.findLines,
    candidateLines: match.candidateLines,
    replace,
  });
  const next =
    content.slice(0, match.startOffset) +
    replacement +
    content.slice(match.endOffset);
  if (maxBytes !== undefined && Buffer.byteLength(next, "utf8") > maxBytes) {
    return {
      ok: false,
      code: "WRITE_FAILED",
      message: `recovered replacement exceeds ${maxBytes} byte cap`,
    };
  }

  return {
    ok: true,
    content: next,
    strategy: "indentation",
    replacementCount: 1,
    matchedLineRange: {
      startLine: match.startLine,
      endLine: match.endLine,
      strategy: "indentation",
    },
  };
}

export function countOccurrences(source: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = 0;
  while (index <= source.length - needle.length) {
    const next = source.indexOf(needle, index);
    if (next === -1) break;
    count += 1;
    index = next + needle.length;
  }
  return count;
}

function recoveryDisabledMessage(
  reason: RecoveryDisabledReason | undefined,
): string {
  if (reason === "guarded") {
    return "find text did not match exactly; automatic indentation recovery is disabled for guarded files. Use exact text or replace_lines";
  }
  if (reason === "replaceAll") {
    return "find text did not match exactly; replaceAll does not use indentation recovery";
  }
  return "find text did not match file content exactly; re-read the relevant range and retry with current text";
}

function indentationEquivalentMatches(
  content: string,
  find: string,
): Array<{
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  findLines: string[];
  candidateLines: string[];
}> {
  const findLines = find.split("\n");
  if (findLines.length === 0) return [];
  const contentLines = content.split("\n");
  if (findLines.length > contentLines.length) return [];

  const lineStarts = lineStartOffsets(contentLines);
  const matches: Array<{
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
    findLines: string[];
    candidateLines: string[];
  }> = [];

  for (
    let start = 0;
    start <= contentLines.length - findLines.length;
    start += 1
  ) {
    const candidateLines = contentLines.slice(start, start + findLines.length);
    if (!trimEquivalentLineBlock(findLines, candidateLines)) continue;
    const candidateBlock = candidateLines.join("\n");
    matches.push({
      startOffset: lineStarts[start] ?? 0,
      endOffset: (lineStarts[start] ?? 0) + candidateBlock.length,
      startLine: start + 1,
      endLine: start + findLines.length,
      findLines,
      candidateLines,
    });
  }

  return matches;
}

function trimEquivalentLineBlock(
  findLines: readonly string[],
  candidateLines: readonly string[],
): boolean {
  if (findLines.length !== candidateLines.length) return false;
  return findLines.every((findLine, index) => {
    const candidateLine = candidateLines[index] ?? "";
    if (findLine.trim().length === 0) {
      return candidateLine.trim().length === 0;
    }
    if (candidateLine.trim().length === 0) return false;
    return findLine.trim() === candidateLine.trim();
  });
}

function indentationRecoveredReplacement({
  findLines,
  candidateLines,
  replace,
}: {
  findLines: readonly string[];
  candidateLines: readonly string[];
  replace: string;
}): string {
  const replacementLines = replace.split("\n");
  const baseIndent = firstIndentPair(findLines, candidateLines);
  const adjusted = replacementLines.map((line, index) => {
    if (line.trim().length === 0) return "";
    const findLine = findLines[index];
    const candidateLine = candidateLines[index];
    if (
      findLine !== undefined &&
      candidateLine !== undefined &&
      findLine.trim().length > 0 &&
      line.trim() === findLine.trim()
    ) {
      return candidateLine;
    }
    if (!baseIndent) return line;
    if (line.startsWith(baseIndent.findIndent)) {
      return `${baseIndent.candidateIndent}${line.slice(baseIndent.findIndent.length)}`;
    }
    return `${baseIndent.candidateIndent}${line.trimStart()}`;
  });
  return adjusted.join("\n");
}

function firstIndentPair(
  findLines: readonly string[],
  candidateLines: readonly string[],
): { findIndent: string; candidateIndent: string } | undefined {
  for (let index = 0; index < findLines.length; index += 1) {
    const findLine = findLines[index] ?? "";
    const candidateLine = candidateLines[index] ?? "";
    if (findLine.trim().length === 0 || candidateLine.trim().length === 0) {
      continue;
    }
    return {
      findIndent: leadingWhitespace(findLine),
      candidateIndent: leadingWhitespace(candidateLine),
    };
  }
  return undefined;
}

function leadingWhitespace(value: string): string {
  return value.match(/^\s*/)?.[0] ?? "";
}

function lineStartOffsets(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
}

export function buildDisplayDiff(
  oldContent: string,
  newContent: string,
  maxChars = MODEL_DIFF_MAX_CHARS,
): string {
  const oldLines = normalizeToLF(oldContent).split("\n");
  const newLines = normalizeToLF(newContent).split("\n");
  const maxLen = Math.max(oldLines.length, newLines.length);
  const lines: string[] = [];
  for (let index = 0; index < maxLen; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine) {
      if (oldLine !== undefined) lines.push(`  ${oldLine}`);
      continue;
    }
    if (oldLine !== undefined) lines.push(`- ${oldLine}`);
    if (newLine !== undefined) lines.push(`+ ${newLine}`);
  }
  const diff = lines.join("\n");
  if (diff.length <= maxChars) return diff;
  return `${diff.slice(0, maxChars)}\n… (diff truncated)`;
}
