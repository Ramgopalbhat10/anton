import fs from "node:fs/promises";
import path from "node:path";

import { TEXT_FILE_MAX_BYTES, sha256 } from "./edit-utils";

const BINARY_SAMPLE_BYTES = 8192;
const HASH_MAX_BYTES = 10 * 1024 * 1024;
const DESCENDANT_SCAN_LIMIT = 1000;

const GENERATED_SEGMENTS = new Set([
  ".git",
  ".next",
  "build",
  "dist",
  "node_modules",
  "out",
]);

const LOCKFILE_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "package-lock.json",
  "pipfile.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "yarn.lock",
]);

export type FileGuard = {
  guarded: boolean;
  reasons: string[];
};

export type FileMetadata = {
  kind: FileKind;
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
  sha256?: string;
  guard: FileGuard;
};

export type FileKind = "file" | "directory" | "symlink" | "other";

export async function fileMetadata(
  absPath: string,
  relPath: string,
): Promise<FileMetadata> {
  const lstat = await fs.lstat(absPath);
  const stat = lstat.isSymbolicLink() ? lstat : await fs.stat(absPath);
  const kind = fileKind(lstat);
  const reasons = pathGuardReasons(relPath);

  if (kind === "symlink") {
    reasons.push("symbolic links require explicit guarded-file intent");
  }

  let digest: string | undefined;
  if (kind === "file") {
    if (stat.size > TEXT_FILE_MAX_BYTES) {
      reasons.push(`large file exceeds ${TEXT_FILE_MAX_BYTES} bytes`);
    }
    if (await looksBinary(absPath)) {
      reasons.push("binary file content requires explicit guarded-file intent");
    }
    if (stat.size <= HASH_MAX_BYTES) {
      digest = sha256(await fs.readFile(absPath));
    }
  }

  return {
    kind,
    sizeBytes: stat.size,
    createdAt: stat.birthtime.toISOString(),
    modifiedAt: stat.mtime.toISOString(),
    sha256: digest,
    guard: {
      guarded: reasons.length > 0,
      reasons,
    },
  };
}

export function pathGuardReasons(relPath: string): string[] {
  const normalized = normalizeRelPath(relPath);
  const parts = normalized.split("/").filter(Boolean);
  const lowerParts = parts.map((part) => part.toLowerCase());
  const base = lowerParts.at(-1) ?? "";
  const reasons: string[] = [];

  if (lowerParts.some((part) => GENERATED_SEGMENTS.has(part))) {
    reasons.push("generated, dependency, or build output path");
  }
  if (LOCKFILE_NAMES.has(base)) {
    reasons.push("lockfile changes require explicit guarded-file intent");
  }
  if (lowerParts.includes("migrations")) {
    reasons.push("migration files require explicit guarded-file intent");
  }
  if (
    base.includes(".generated.") ||
    base.includes(".gen.") ||
    base.endsWith(".min.js") ||
    base.endsWith(".min.css")
  ) {
    reasons.push("generated file changes require explicit guarded-file intent");
  }

  return reasons;
}

export async function assertGuardAllowed({
  absPath,
  relPath,
  allowGuarded,
}: {
  absPath: string;
  relPath: string;
  allowGuarded: boolean;
}): Promise<FileMetadata> {
  const metadata = await fileMetadata(absPath, relPath);
  if (metadata.guard.guarded && !allowGuarded) {
    throw new Error(guardError(relPath, metadata.guard.reasons));
  }
  return metadata;
}

export function assertPathGuardAllowed({
  relPath,
  allowGuarded,
}: {
  relPath: string;
  allowGuarded: boolean;
}): void {
  const reasons = pathGuardReasons(relPath);
  if (reasons.length > 0 && !allowGuarded) {
    throw new Error(guardError(relPath, reasons));
  }
}

export async function assertNoGuardedDescendants({
  absPath,
  relPath,
  allowGuarded,
}: {
  absPath: string;
  relPath: string;
  allowGuarded: boolean;
}): Promise<void> {
  if (allowGuarded) return;
  const guarded = await findGuardedDescendant(absPath, relPath);
  if (guarded) {
    throw new Error(guardError(guarded.path, guarded.reasons));
  }
}

export function verifyExpectedHash({
  relPath,
  actualHash,
  expectedHash,
}: {
  relPath: string;
  actualHash: string | undefined;
  expectedHash: string | undefined;
}): void {
  if (!expectedHash) {
    throw new Error(`expectedSourceHash or expectedHash is required for ${relPath}`);
  }
  if (!actualHash) {
    throw new Error(`hash unavailable for ${relPath}; pass allowGuarded only when intentional`);
  }
  if (actualHash !== expectedHash) {
    throw new Error(
      `hash mismatch for ${relPath}: expected ${expectedHash}, found ${actualHash}`,
    );
  }
}

export function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function fileKind(stat: Awaited<ReturnType<typeof fs.lstat>>): FileKind {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  return "other";
}

async function looksBinary(absPath: string): Promise<boolean> {
  const file = await fs.open(absPath, "r");
  try {
    const buffer = Buffer.alloc(BINARY_SAMPLE_BYTES);
    const { bytesRead } = await file.read(buffer, 0, BINARY_SAMPLE_BYTES, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (sample.includes(0)) return true;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(sample);
      return false;
    } catch {
      return true;
    }
  } finally {
    await file.close();
  }
}

async function findGuardedDescendant(
  absPath: string,
  relPath: string,
): Promise<{ path: string; reasons: string[] } | undefined> {
  let scanned = 0;
  const queue: Array<{ abs: string; rel: string }> = [{ abs: absPath, rel: relPath }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (scanned++ > DESCENDANT_SCAN_LIMIT) {
      return {
        path: current.rel,
        reasons: [`directory scan exceeded ${DESCENDANT_SCAN_LIMIT} entries`],
      };
    }

    const metadata = await fileMetadata(current.abs, current.rel);
    if (metadata.guard.guarded) {
      return { path: current.rel, reasons: metadata.guard.reasons };
    }
    if (metadata.kind !== "directory") continue;

    const children = await fs.readdir(current.abs);
    for (const child of children) {
      queue.push({
        abs: path.join(current.abs, child),
        rel: normalizeRelPath(path.join(current.rel, child)),
      });
    }
  }

  return undefined;
}

function guardError(relPath: string, reasons: string[]): string {
  return `guarded file operation refused for ${relPath}: ${reasons.join("; ")}. Pass allowGuarded: true only when this guarded change is intentional.`;
}
