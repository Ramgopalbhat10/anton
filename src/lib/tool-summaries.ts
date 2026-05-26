function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errorMessageOrUndefined(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function summarizeToolInput(
  input: unknown,
  compact: (value: string, maxLength?: number) => string,
): string | undefined {
  if (!isRecord(input)) return undefined;
  for (const key of ["command", "path", "sourcePath", "pattern", "slug", "task"]) {
    const value = stringValue(input[key]);
    if (value) return compact(value, 500);
  }
  return undefined;
}

export function summarizeToolOutput(
  toolName: string,
  output: unknown,
  error: unknown,
  compact: (value: string, maxLength?: number) => string,
): string | undefined {
  const message = errorMessageOrUndefined(error);
  if (message) return compact(message, 500);
  if (!isRecord(output)) return undefined;

  if (toolName === "read_file" && output.ok === true) {
    const totalLines = numberValue(output.totalLines);
    const sizeBytes = numberValue(output.sizeBytes);
    const startLine = numberValue(output.startLine);
    const endLine = numberValue(output.endLine);
    const parts: string[] = [];
    if (totalLines !== undefined) {
      parts.push(`${totalLines.toLocaleString()} lines`);
    }
    if (sizeBytes !== undefined) {
      parts.push(formatBytes(sizeBytes));
    }
    if (
      startLine !== undefined &&
      endLine !== undefined &&
      totalLines !== undefined &&
      (startLine > 1 || endLine < totalLines)
    ) {
      parts.push(`view ${startLine}-${endLine}`);
    }
    if (parts.length > 0) return parts.join(" · ");
  }

  if (toolName === "read_dir" && output.ok === true) {
    const entries = output.entries;
    if (Array.isArray(entries)) {
      return `${entries.length} entries`;
    }
  }

  if (
    (toolName === "write_file" || toolName === "edit_file" || toolName === "edit_text" || toolName === "replace_text" || toolName === "replace_lines" || toolName === "multi_replace_text") &&
    output.ok === true
  ) {
    const bytesWritten = numberValue(output.bytesWritten);
    if (bytesWritten !== undefined) {
      return `${bytesWritten.toLocaleString()} bytes written`;
    }
    if (output.existed === false) return "created";
    if (output.existed === true) return "updated";
  }

  if (toolName === "grep" && output.ok === true) {
    const matchCount = numberValue(output.matchCount);
    if (matchCount !== undefined) {
      return `${matchCount.toLocaleString()} matches`;
    }
  }

  if (toolName === "glob" && output.ok === true) {
    const paths = output.paths;
    if (Array.isArray(paths)) {
      return `${paths.length} paths`;
    }
  }

  for (const key of ["error", "failedReason", "summary", "stdout"]) {
    const value = stringValue(output[key]);
    if (value) return compact(value, 500);
  }

  if (toolName !== "read_file") {
    const path = stringValue(output.path);
    if (path) return compact(path, 500);
  }

  const exitCode = outputExitCode(output);
  return exitCode !== undefined ? `exit ${exitCode}` : undefined;
}

export function outputExitCode(output: unknown): number | undefined {
  if (!isRecord(output)) return undefined;
  const exitCode = output.exitCode;
  return typeof exitCode === "number" && Number.isInteger(exitCode)
    ? exitCode
    : undefined;
}
