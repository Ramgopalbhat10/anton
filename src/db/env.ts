import fs from "node:fs";
import path from "node:path";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function loadDatabaseEnvFiles(cwd = process.cwd()): void {
  for (const file of envFilesForMode(process.env.NODE_ENV)) {
    loadEnvFile(path.join(cwd, file));
  }
}

function envFilesForMode(mode: string | undefined): string[] {
  const normalized = mode?.trim();
  const files: string[] = [];
  if (normalized) files.push(`.env.${normalized}.local`);
  if (normalized !== "test") files.push(".env.local");
  if (normalized) files.push(`.env.${normalized}`);
  files.push(".env");
  return files;
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] !== undefined) continue;
    process.env[parsed.key] = parsed.value;
  }
}

function parseEnvLine(line: string): { key: string; value: string } | undefined {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (!match) return undefined;
  const key = match[1] ?? "";
  if (!ENV_KEY_PATTERN.test(key)) return undefined;
  return { key, value: parseEnvValue(match[2] ?? "") };
}

function parseEnvValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }
  return raw.replace(/\s+#.*$/, "").trim();
}
