import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { applyPatch, parsePatch } from "diff";

export const TEXT_FILE_MAX_BYTES = 1024 * 1024;
export const READ_FILE_MAX_BYTES = 256 * 1024;
export const DIFF_PREVIEW_BYTES = 128 * 1024;

export type TextFileSnapshot = {
  content: string;
  sizeBytes: number;
  sha256: string;
};

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function applySingleFilePatch({
  source,
  patch,
  relPath,
}: {
  source: string;
  patch: string;
  relPath: string;
}): string {
  try {
    const parsed = parseSingleFilePatch(patch, relPath);
    const next = applyPatch(source, parsed, { fuzzFactor: 0 });
    if (next === false) {
      throw new Error("could not apply patch to current file content");
    }
    return next;
  } catch (err) {
    const fallback = applyExactHunkPatch(source, patch);
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

export function exactHunkPatchAlreadyApplied({
  source,
  patch,
}: {
  source: string;
  patch: string;
}): boolean {
  const blocks = exactHunkBlocks(source, patch);
  if (!blocks) return false;
  return blocks.blocks.every(
    (block) =>
      !blocks.normalizedSource.includes(block.oldBlock) &&
      blocks.normalizedSource.includes(block.newBlock),
  );
}

function applyExactHunkPatch(
  source: string,
  patch: string,
): string | undefined {
  const blocks = exactHunkBlocks(source, patch);
  if (!blocks) return undefined;
  let next = blocks.normalizedSource;
  for (const block of blocks.blocks) {
    if (!block.oldBlock) return undefined;
    const first = next.indexOf(block.oldBlock);
    if (first === -1) return undefined;
    if (next.indexOf(block.oldBlock, first + block.oldBlock.length) !== -1) {
      return undefined;
    }
    next =
      next.slice(0, first) +
      block.newBlock +
      next.slice(first + block.oldBlock.length);
  }
  return next.replace(/\n/g, blocks.newline);
}

function exactHunkBlocks(
  source: string,
  patch: string,
):
  | {
      normalizedSource: string;
      blocks: { oldBlock: string; newBlock: string }[];
      newline: string;
    }
  | undefined {
  const rawLines = patch.replace(/\r\n/g, "\n").split("\n");
  const hunkStarts = rawLines.flatMap((line, index) =>
    line.startsWith("@@") ? [index] : [],
  );
  if (hunkStarts.length === 0) return undefined;

  const blocks: { oldBlock: string; newBlock: string }[] = [];
  for (const [index, hunkStart] of hunkStarts.entries()) {
    const nextHunkStart = hunkStarts[index + 1] ?? rawLines.length;
    const hunkLines = rawLines
      .slice(hunkStart + 1, nextHunkStart)
      .filter((line) => line.length > 0 && !line.startsWith("\\ No newline"));
    const block = exactHunkBlock(hunkLines);
    if (!block) return undefined;
    blocks.push(block);
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const normalizedSource = source.replace(/\r\n/g, "\n");
  return { normalizedSource, blocks, newline };
}

function exactHunkBlock(
  hunkLines: string[],
): { oldBlock: string; newBlock: string } | undefined {
  if (hunkLines.length === 0) return undefined;
  if (hunkLines.some((line) => !/^[-+ ]/.test(line))) return undefined;
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let removed = 0;
  let added = 0;
  for (const line of hunkLines) {
    const prefix = line[0];
    const content = line.slice(1);
    if (prefix === " ") {
      oldLines.push(content);
      newLines.push(content);
    } else if (prefix === "-") {
      oldLines.push(content);
      removed += 1;
    } else if (prefix === "+") {
      newLines.push(content);
      added += 1;
    }
  }

  if (removed === 0 && added === 0) return undefined;
  const oldBlock = oldLines.join("\n");
  const newBlock = newLines.join("\n");
  return { oldBlock, newBlock };
}

function parseSingleFilePatch(
  patch: string,
  relPath: string,
): ReturnType<typeof parsePatch>[number] {
  let parsed: ReturnType<typeof parsePatch>;
  try {
    parsed = parsePatch(patch);
  } catch (err) {
    throw new Error(`patch could not be parsed: ${errorMessage(err)}`);
  }
  if (parsed.length !== 1) {
    throw new Error("patch must be a single-file unified diff");
  }

  const [single] = parsed;
  if (!single) {
    throw new Error("patch must include one file diff");
  }
  if (
    single.isBinary ||
    single.isCreate ||
    single.isDelete ||
    single.isRename ||
    single.isCopy ||
    single.oldFileName === "/dev/null" ||
    single.newFileName === "/dev/null"
  ) {
    throw new Error("create, delete, rename, copy, and binary patches are not supported");
  }

  const expected = normalizePatchPath(relPath);
  for (const patchPath of [single.oldFileName, single.newFileName]) {
    const normalized = normalizePatchPath(patchPath);
    if (normalized && normalized !== expected) {
      throw new Error(`patch path ${normalized} does not match target ${expected}`);
    }
  }

  return single;
}

export async function readTextFileSnapshot(
  abs: string,
  maxBytes: number,
): Promise<TextFileSnapshot> {
  const stat = await fs.stat(abs);
  if (!stat.isFile()) {
    throw new Error("not a regular file");
  }
  if (stat.size > maxBytes) {
    throw new Error(`file too large (${stat.size} bytes, cap ${maxBytes})`);
  }

  const bytes = await fs.readFile(abs);
  return decodeTextSnapshot(bytes);
}

export function decodeTextSnapshot(bytes: Buffer): TextFileSnapshot {
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("file is not valid UTF-8 text");
  }
  if (content.includes("\0")) {
    throw new Error("binary file content is not supported");
  }
  return {
    content,
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

export async function atomicWriteTextFile(
  abs: string,
  content: string,
): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, abs);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function createTextFileExclusive(
  abs: string,
  content: string,
): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, content, "utf8");
    await fs.link(tmp, abs);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

export async function readExistingTextPreview(abs: string): Promise<
  | {
      existed: true;
      previousContent: string;
      previousHash: string;
      previousTruncated: false;
    }
  | {
      existed: true;
      previousContent: "";
      previousHash?: undefined;
      previousTruncated: true;
    }
  | {
      existed: false;
      previousContent: "";
      previousHash?: undefined;
      previousTruncated: false;
    }
> {
  try {
    const snapshot = await readTextFileSnapshot(abs, DIFF_PREVIEW_BYTES);
    return {
      existed: true,
      previousContent: snapshot.content,
      previousHash: snapshot.sha256,
      previousTruncated: false,
    };
  } catch (err) {
    if (isNotFound(err)) {
      return { existed: false, previousContent: "", previousTruncated: false };
    }
    if (err instanceof Error && /file too large/i.test(err.message)) {
      return { existed: true, previousContent: "", previousTruncated: true };
    }
    throw err;
  }
}

export async function fileExists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

export function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

function normalizePatchPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const slashPath = value.replace(/\\/g, "/");
  if (slashPath === "/dev/null") return slashPath;
  if (slashPath.startsWith("a/") || slashPath.startsWith("b/")) {
    return slashPath.slice(2);
  }
  return slashPath;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
