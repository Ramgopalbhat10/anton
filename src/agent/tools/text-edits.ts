export type TextEdit = {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
};

export type ApplyTextEditsResult =
  | { ok: true; content: string; appliedCount: number }
  | { ok: false; index: number; code: "FIND_NOT_FOUND" | "FIND_NOT_UNIQUE"; message: string };

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
): ApplyTextEditsResult {
  const lineEnding = detectLineEnding(source);
  let content = normalizeToLF(source);
  let appliedCount = 0;

  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    const normalizedOld = normalizeToLF(edit.oldText);
    const normalizedNew = normalizeToLF(edit.newText);
    if (normalizedOld === normalizedNew) continue;

    const applied = applySingleEdit(content, {
      oldText: normalizedOld,
      newText: normalizedNew,
      replaceAll: edit.replaceAll,
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
  }

  return {
    ok: true,
    content: restoreLineEndings(content, lineEnding),
    appliedCount,
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

function applySingleEdit(
  content: string,
  edit: TextEdit,
):
  | { ok: true; content: string; replacementCount: number }
  | { ok: false; code: "FIND_NOT_FOUND" | "FIND_NOT_UNIQUE"; message: string } {
  const replaceAll = edit.replaceAll === true;
  const occurrences = countOccurrences(content, edit.oldText);
  if (occurrences === 0) {
    return {
      ok: false,
      code: "FIND_NOT_FOUND",
      message: "oldText did not match file content exactly",
    };
  }
  if (!replaceAll && occurrences > 1) {
    return {
      ok: false,
      code: "FIND_NOT_UNIQUE",
      message: `oldText occurs ${occurrences} times; set replaceAll: true or include more surrounding context`,
    };
  }
  const next = replaceAll
    ? content.split(edit.oldText).join(edit.newText)
    : content.replace(edit.oldText, edit.newText);
  return {
    ok: true,
    content: next,
    replacementCount: replaceAll ? occurrences : 1,
  };
}

function countOccurrences(source: string, needle: string): number {
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
