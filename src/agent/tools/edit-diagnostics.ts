export type NearMatch = {
  line: number;
  text: string;
};

export function findPreview(find: string, maxChars = 120): string {
  const normalized = find.replace(/\r\n/g, "\n");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
}

export function nearMatchesForFind(
  content: string,
  find: string,
  limit = 5,
): NearMatch[] {
  const needle = primaryFindNeedle(find);
  const normalizedFind = normalizeForScore(find);
  if (!needle && !normalizedFind) return [];
  const lines = content.split("\n");
  const matches: (NearMatch & { score: number })[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.replace(/\r$/, "") ?? "";
    const score = scoreNearLine(line, needle, normalizedFind);
    if (score <= 0) continue;
    matches.push({
      line: index + 1,
      text: truncateLine(line, 160),
      score,
    });
  }
  return matches
    .sort((a, b) => b.score - a.score || a.line - b.line)
    .slice(0, limit)
    .map(({ line, text }) => ({ line, text }));
}

function primaryFindNeedle(find: string): string | undefined {
  const normalized = find.replace(/\r\n/g, "\n");
  const firstLine = normalized.split("\n").find((line) => line.trim().length > 0);
  if (!firstLine) return undefined;
  const trimmed = firstLine.trim();
  if (trimmed.length >= 8) return trimmed;
  if (normalized.length >= 8) return normalized.slice(0, 80);
  return trimmed.length > 0 ? trimmed : undefined;
}

function scoreNearLine(
  line: string,
  needle: string | undefined,
  normalizedFind: string,
): number {
  const trimmed = line.trim();
  if (!trimmed) return 0;
  if (needle && line.includes(needle)) return 100;

  const normalizedLine = normalizeForScore(trimmed);
  if (!normalizedLine || !normalizedFind) return 0;
  if (normalizedFind.includes(normalizedLine) || normalizedLine.includes(normalizedFind)) {
    return 90;
  }

  const findTokens = tokenSet(normalizedFind);
  const lineTokens = tokenSet(normalizedLine);
  if (findTokens.size === 0 || lineTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of lineTokens) {
    if (findTokens.has(token)) overlap += 1;
  }
  const score = Math.round((overlap / Math.max(findTokens.size, lineTokens.size)) * 80);
  return score >= 35 ? score : 0;
}

function normalizeForScore(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[{}()[\];,'"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(" ").filter((token) => token.length >= 2));
}

function truncateLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  return `${line.slice(0, maxChars)}…`;
}
