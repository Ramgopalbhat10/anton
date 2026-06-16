import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
  resolveInWorkspace,
} from "../sandbox";
import { TEXT_FILE_MAX_BYTES, atomicWriteTextFile, isNotFound } from "./edit-utils";
import { normalizeRelPath, pathGuardReasons } from "./file-guardrails";

type TextCheckpointEntry = {
  path: string;
  state: "text";
  content: string;
  hash: string;
};

type AbsentCheckpointEntry = {
  path: string;
  state: "absent";
};

type UnsupportedCheckpointEntry = {
  path: string;
  state: "unsupported";
  reasons: string[];
};

type CheckpointEntry =
  | TextCheckpointEntry
  | AbsentCheckpointEntry
  | UnsupportedCheckpointEntry;

type CurrentPathState =
  | { state: "text"; hash: string }
  | { state: "absent" }
  | { state: "unsupported"; reasons: string[] };

type CheckpointPathChange = {
  path: string;
  kind: "created" | "deleted" | "modified";
  checkpointHash?: string;
  currentHash?: string;
};

export type CheckpointCaptureResult = {
  path: string;
  status: "captured" | "already_captured";
  state: CheckpointEntry["state"];
  hash?: string;
  reasons?: string[];
};

export type CheckpointPathDetail = {
  path: string;
  reasons: string[];
};

export type CheckpointComparison = {
  hasEntries: boolean;
  checkpointHash?: string;
  checkpointedPaths: string[];
  checkpointUnsupportedPaths: string[];
  unsupportedPathDetails: CheckpointPathDetail[];
  coveredPaths: string[];
};

export type CheckpointRestoreResult =
  | {
      ok: true;
      checkpointRestoredPaths: string[];
      unsupportedPaths: string[];
      unsupportedPathDetails: CheckpointPathDetail[];
      checkpointHash?: string;
      coveredPaths: string[];
    }
  | {
      ok: false;
      error: string;
      checkpointRestoredPaths: string[];
      unsupportedPaths: string[];
      unsupportedPathDetails: CheckpointPathDetail[];
      checkpointHash?: string;
      coveredPaths: string[];
    };

export type RunCheckpointManager = {
  capturePath(relPath: string): Promise<CheckpointCaptureResult>;
  capturePaths(relPaths: readonly string[]): Promise<CheckpointCaptureResult[]>;
  discardCaptures(captures: readonly CheckpointCaptureResult[]): void;
  compare(scopes: readonly string[]): Promise<CheckpointComparison>;
  restore(scopes: readonly string[]): Promise<CheckpointRestoreResult>;
};

export function createRunCheckpointManager(
  workspaceRoot?: string,
): RunCheckpointManager {
  return new InMemoryRunCheckpointManager(workspaceRoot);
}

export function pathOverlapsCheckpointPath(
  candidatePath: string,
  checkpointPath: string,
): boolean {
  const candidate = normalizeComparablePath(candidatePath);
  const checkpoint = normalizeComparablePath(checkpointPath);
  return (
    candidate === checkpoint ||
    candidate.startsWith(`${checkpoint}/`) ||
    checkpoint.startsWith(`${candidate}/`)
  );
}

class InMemoryRunCheckpointManager implements RunCheckpointManager {
  private readonly entries = new Map<string, CheckpointEntry>();

  constructor(private readonly workspaceRoot?: string) {}

  async capturePath(relPath: string): Promise<CheckpointCaptureResult> {
    const normalized = this.normalizePath(relPath);
    const existing = this.entries.get(normalized);
    if (existing) {
      return captureResult(existing, "already_captured");
    }

    const entry = await this.snapshotPath(normalized);
    this.entries.set(normalized, entry);
    return captureResult(entry, "captured");
  }

  async capturePaths(
    relPaths: readonly string[],
  ): Promise<CheckpointCaptureResult[]> {
    const results: CheckpointCaptureResult[] = [];
    for (const relPath of relPaths) {
      results.push(await this.capturePath(relPath));
    }
    return results;
  }

  discardCaptures(captures: readonly CheckpointCaptureResult[]): void {
    for (const capture of captures) {
      if (capture.status === "captured") {
        this.entries.delete(capture.path);
      }
    }
  }

  async compare(scopes: readonly string[]): Promise<CheckpointComparison> {
    return this.compareEntries(scopes);
  }

  async restore(scopes: readonly string[]): Promise<CheckpointRestoreResult> {
    const comparison = await this.compareEntries(scopes);
    if (comparison.unsupportedPathDetails.length > 0) {
      return {
        ok: false,
        error: unsupportedRestoreError(comparison.unsupportedPathDetails),
        checkpointRestoredPaths: [],
        unsupportedPaths: comparison.checkpointUnsupportedPaths,
        unsupportedPathDetails: comparison.unsupportedPathDetails,
        ...(comparison.checkpointHash
          ? { checkpointHash: comparison.checkpointHash }
          : {}),
        coveredPaths: comparison.coveredPaths,
      };
    }

    const restoredPaths: string[] = [];
    const entries = this.entriesForScopes(scopes);
    for (const entry of entries) {
      if (entry.state === "unsupported") continue;
      const current = await this.currentPathState(entry.path);
      if (current.state === "unsupported") {
        const details = [{ path: entry.path, reasons: current.reasons }];
        return {
          ok: false,
          error: unsupportedRestoreError(details),
          checkpointRestoredPaths: restoredPaths,
          unsupportedPaths: details.map((detail) => detail.path),
          unsupportedPathDetails: details,
          ...(comparison.checkpointHash
            ? { checkpointHash: comparison.checkpointHash }
            : {}),
          coveredPaths: comparison.coveredPaths,
        };
      }

      if (entry.state === "absent") {
        if (current.state === "absent") continue;
        await fs.rm(this.absPath(entry.path), { force: false });
        restoredPaths.push(entry.path);
        continue;
      }

      if (current.state === "text" && current.hash === entry.hash) continue;
      await atomicWriteTextFile(this.absPath(entry.path), entry.content);
      restoredPaths.push(entry.path);
    }

    return {
      ok: true,
      checkpointRestoredPaths: uniqueSorted(restoredPaths),
      unsupportedPaths: [],
      unsupportedPathDetails: [],
      ...(comparison.checkpointHash
        ? { checkpointHash: comparison.checkpointHash }
        : {}),
      coveredPaths: comparison.coveredPaths,
    };
  }

  private async compareEntries(
    scopes: readonly string[],
  ): Promise<CheckpointComparison> {
    const entries = this.entriesForScopes(scopes);
    const changes: CheckpointPathChange[] = [];
    const unsupportedDetails: CheckpointPathDetail[] = [];

    for (const entry of entries) {
      if (entry.state === "unsupported") {
        unsupportedDetails.push({ path: entry.path, reasons: entry.reasons });
        continue;
      }

      const current = await this.currentPathState(entry.path);
      if (current.state === "unsupported") {
        unsupportedDetails.push({ path: entry.path, reasons: current.reasons });
        continue;
      }

      if (entry.state === "absent") {
        if (current.state === "text") {
          changes.push({
            path: entry.path,
            kind: "created",
            currentHash: current.hash,
          });
        }
        continue;
      }

      if (current.state === "absent") {
        changes.push({
          path: entry.path,
          kind: "deleted",
          checkpointHash: entry.hash,
        });
      } else if (current.hash !== entry.hash) {
        changes.push({
          path: entry.path,
          kind: "modified",
          checkpointHash: entry.hash,
          currentHash: current.hash,
        });
      }
    }

    const checkpointHash = hashComparison(changes, unsupportedDetails);
    return {
      hasEntries: entries.length > 0,
      ...(checkpointHash ? { checkpointHash } : {}),
      checkpointedPaths: uniqueSorted(changes.map((change) => change.path)),
      checkpointUnsupportedPaths: uniqueSorted(
        unsupportedDetails.map((detail) => detail.path),
      ),
      unsupportedPathDetails: unsupportedDetails.sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
      coveredPaths: uniqueSorted(entries.map((entry) => entry.path)),
    };
  }

  private entriesForScopes(scopes: readonly string[]): CheckpointEntry[] {
    const normalizedScopes = scopes.map((scope) => normalizeComparablePath(scope));
    return [...this.entries.values()]
      .filter(
        (entry) =>
          normalizedScopes.length === 0 ||
          normalizedScopes.some((scope) =>
            pathOverlapsCheckpointPath(entry.path, scope),
          ),
      )
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private async snapshotPath(normalized: string): Promise<CheckpointEntry> {
    const guardReasons = pathGuardReasons(normalized);
    if (guardReasons.length > 0) {
      return {
        path: normalized,
        state: "unsupported",
        reasons: guardReasons,
      };
    }

    const abs = this.absPath(normalized);
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(abs);
    } catch (err) {
      if (isNotFound(err)) return { path: normalized, state: "absent" };
      throw err;
    }

    if (stat.isSymbolicLink()) {
      return unsupportedEntry(normalized, "symbolic links are not checkpoint-restorable");
    }
    if (stat.isDirectory()) {
      return unsupportedEntry(normalized, "directories are not checkpoint-restorable");
    }
    if (!stat.isFile()) {
      return unsupportedEntry(normalized, "non-file paths are not checkpoint-restorable");
    }
    if (stat.size > TEXT_FILE_MAX_BYTES) {
      return unsupportedEntry(
        normalized,
        `large file exceeds ${TEXT_FILE_MAX_BYTES} bytes`,
      );
    }

    const bytes = await fs.readFile(abs);
    const decoded = decodeUtf8Text(bytes);
    if (!decoded.ok) {
      return unsupportedEntry(normalized, decoded.reason);
    }
    return {
      path: normalized,
      state: "text",
      content: decoded.content,
      hash: sha256(bytes),
    };
  }

  private async currentPathState(relPath: string): Promise<CurrentPathState> {
    const guardReasons = pathGuardReasons(relPath);
    if (guardReasons.length > 0) {
      return { state: "unsupported", reasons: guardReasons };
    }

    const abs = this.absPath(relPath);
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(abs);
    } catch (err) {
      if (isNotFound(err)) return { state: "absent" };
      throw err;
    }

    if (stat.isSymbolicLink()) {
      return {
        state: "unsupported",
        reasons: ["symbolic links are not checkpoint-restorable"],
      };
    }
    if (stat.isDirectory()) {
      return {
        state: "unsupported",
        reasons: ["directories are not checkpoint-restorable"],
      };
    }
    if (!stat.isFile()) {
      return {
        state: "unsupported",
        reasons: ["non-file paths are not checkpoint-restorable"],
      };
    }
    if (stat.size > TEXT_FILE_MAX_BYTES) {
      return {
        state: "unsupported",
        reasons: [`large file exceeds ${TEXT_FILE_MAX_BYTES} bytes`],
      };
    }

    const bytes = await fs.readFile(abs);
    const decoded = decodeUtf8Text(bytes);
    if (!decoded.ok) {
      return { state: "unsupported", reasons: [decoded.reason] };
    }
    return { state: "text", hash: sha256(bytes) };
  }

  private normalizePath(relPath: string): string {
    const root = this.root();
    const abs = resolveInWorkspace(relPath, root);
    const normalized = normalizeRelPath(path.relative(root, abs));
    if (!normalized || normalized === ".") {
      throw new Error("checkpoint paths must name a file or directory");
    }
    return normalized;
  }

  private absPath(relPath: string): string {
    return resolveInWorkspace(relPath, this.root());
  }

  private root(): string {
    return this.workspaceRoot
      ? ensureWorkspaceRootAt(this.workspaceRoot)
      : ensureWorkspaceRoot();
  }
}

function captureResult(
  entry: CheckpointEntry,
  status: CheckpointCaptureResult["status"],
): CheckpointCaptureResult {
  return {
    path: entry.path,
    status,
    state: entry.state,
    ...(entry.state === "text" ? { hash: entry.hash } : {}),
    ...(entry.state === "unsupported" ? { reasons: entry.reasons } : {}),
  };
}

function unsupportedEntry(
  relPath: string,
  reason: string,
): UnsupportedCheckpointEntry {
  return {
    path: relPath,
    state: "unsupported",
    reasons: [reason],
  };
}

function decodeUtf8Text(
  bytes: Buffer,
): { ok: true; content: string } | { ok: false; reason: string } {
  let content: string;
  try {
    content = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    return { ok: false, reason: "file is not valid UTF-8 text" };
  }
  if (content.includes("\0")) {
    return { ok: false, reason: "binary file content is not supported" };
  }
  return { ok: true, content };
}

function hashComparison(
  changes: readonly CheckpointPathChange[],
  unsupportedDetails: readonly CheckpointPathDetail[],
): string | undefined {
  const lines = [
    ...changes.map((change) =>
      [
        "change",
        change.kind,
        change.path,
        change.checkpointHash ?? "",
        change.currentHash ?? "",
      ].join("\0"),
    ),
    ...unsupportedDetails.map((detail) =>
      ["unsupported", detail.path, ...detail.reasons].join("\0"),
    ),
  ].sort((left, right) => left.localeCompare(right));
  if (lines.length === 0) return undefined;
  return sha256(Buffer.from(lines.join("\n"), "utf8"));
}

function unsupportedRestoreError(details: readonly CheckpointPathDetail[]): string {
  const summary = details
    .map((detail) => `${detail.path}: ${detail.reasons.join("; ")}`)
    .join("; ");
  return `checkpoint restore refused unsupported path${details.length === 1 ? "" : "s"}: ${summary}`;
}

function normalizeComparablePath(relPath: string): string {
  return normalizeRelPath(relPath).replace(/\/+$/, "");
}

function uniqueSorted(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}
