import fs from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { z } from "zod";
import { tool } from "ai";

import {
  resolveInWorkspace,
  SandboxError,
} from "../sandbox";
import {
  assertGuardAllowed,
  assertNoGuardedDescendants,
  assertPathGuardAllowed,
  fileMetadata,
  normalizeRelPath,
  pathGuardReasons,
  verifyExpectedHash,
} from "./file-guardrails";
import type { RunCheckpointManager } from "./checkpoints";

const allowGuardedSchema = z
  .boolean()
  .optional()
  .describe(
    "Set true only when intentionally mutating a guarded target such as a lockfile, migration, generated file, binary file, or large file.",
  );

export function createReadDirTool(workspaceRoot?: string) {
  return tool({
    description:
      "Read a workspace directory and return child names with basic metadata. Paths are relative to WORKSPACE_ROOT and must stay inside it.",
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe("Directory path relative to the workspace root. Defaults to the workspace root."),
    }),
    execute: async ({ path: relPath = "." }) => {
      try {
        const abs = resolveInWorkspace(relPath, workspaceRoot);
        const entries = await fs.readdir(abs, { withFileTypes: true });
        const rows = await Promise.all(
          entries.map(async (entry) => {
            const childAbs = path.join(abs, entry.name);
            const stat = await fs.lstat(childAbs);
            const childRel = normalizeRelPath(path.join(normalizeInputPath(relPath), entry.name));
            return {
              name: entry.name,
              path: normalizeRelPath(path.join(normalizeInputPath(relPath), entry.name)),
              kind: entryKind(entry),
              sizeBytes: stat.size,
              modifiedAt: stat.mtime.toISOString(),
              guarded: pathGuardReasons(childRel).length > 0,
            };
          }),
        );

        return {
          ok: true as const,
          path: normalizeInputPath(relPath),
          entries: rows.sort((a, b) => a.name.localeCompare(b.name)),
        };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export function createStatTool(workspaceRoot?: string) {
  return tool({
    description:
      "Return metadata for one workspace path, including SHA-256 for regular files up to the file-operation hash cap and guardrail reasons.",
    inputSchema: z.object({
      path: z.string().describe("Path relative to the workspace root."),
    }),
    execute: async ({ path: relPath }) => {
      try {
        const abs = resolveInWorkspace(relPath, workspaceRoot);
        const metadata = await fileMetadata(abs, relPath);
        return {
          ok: true as const,
          path: normalizeInputPath(relPath),
          ...metadata,
        };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export function createMkdirTool(workspaceRoot?: string) {
  return tool({
    description:
      "Create a directory inside the workspace. Requires approval and refuses guarded paths unless allowGuarded is true.",
    inputSchema: z.object({
      path: z.string().describe("Directory path relative to the workspace root."),
      recursive: z
        .boolean()
        .optional()
        .describe("Create parent directories as needed. Defaults to true."),
      allowGuarded: allowGuardedSchema,
    }),
    execute: async ({ path: relPath, recursive = true, allowGuarded = false }) => {
      try {
        assertPathGuardAllowed({ relPath, allowGuarded });
        const abs = resolveInWorkspace(relPath, workspaceRoot);
        await fs.mkdir(abs, { recursive });
        return {
          ok: true as const,
          path: normalizeInputPath(relPath),
          recursive,
        };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export function createDeleteTool(
  workspaceRoot?: string,
  checkpoints?: RunCheckpointManager,
) {
  return tool({
    description:
      "Delete a file or directory inside the workspace. Regular files require expectedHash. Recursive directory deletes require recursive: true. Requires approval.",
    inputSchema: z.object({
      path: z.string().describe("Path relative to the workspace root."),
      expectedHash: z
        .string()
        .optional()
        .describe("Required for regular files. SHA-256 from stat or read_file."),
      recursive: z
        .boolean()
        .optional()
        .describe("Allow recursive directory removal. Defaults to false."),
      allowGuarded: allowGuardedSchema,
    }),
    execute: async ({
      path: relPath,
      expectedHash,
      recursive = false,
      allowGuarded = false,
    }) => {
      try {
        const abs = resolveInWorkspace(relPath, workspaceRoot);
        const metadata = await assertGuardAllowed({ absPath: abs, relPath, allowGuarded });
        if (metadata.kind === "file") {
          verifyExpectedHash({
            relPath,
            actualHash: metadata.sha256,
            expectedHash,
          });
        }
        if (metadata.kind === "directory") {
          await assertNoGuardedDescendants({ absPath: abs, relPath, allowGuarded });
        }
        const checkpoint = await checkpoints?.capturePath(relPath);
        try {
          await fs.rm(abs, { recursive, force: false });
        } catch (err) {
          if (checkpoint) checkpoints?.discardCaptures([checkpoint]);
          throw err;
        }
        return {
          ok: true as const,
          path: normalizeInputPath(relPath),
          kind: metadata.kind,
          ...(checkpoint ? { checkpoint } : {}),
        };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export function createRenameTool(
  workspaceRoot?: string,
  checkpoints?: RunCheckpointManager,
) {
  return tool({
    description:
      "Rename or move a workspace path without overwriting the destination. Regular source files require expectedSourceHash. Requires approval.",
    inputSchema: z.object({
      sourcePath: z.string().describe("Existing source path relative to the workspace root."),
      destinationPath: z
        .string()
        .describe("New destination path relative to the workspace root. Must not already exist."),
      expectedSourceHash: z
        .string()
        .optional()
        .describe("Required for regular source files. SHA-256 from stat or read_file."),
      allowGuarded: allowGuardedSchema,
    }),
    execute: async ({
      sourcePath,
      destinationPath,
      expectedSourceHash,
      allowGuarded = false,
    }) => {
      try {
        assertPathGuardAllowed({ relPath: destinationPath, allowGuarded });
        const sourceAbs = resolveInWorkspace(sourcePath, workspaceRoot);
        const destinationAbs = resolveInWorkspace(destinationPath, workspaceRoot);
        await assertDestinationMissing(destinationAbs, destinationPath);
        const metadata = await assertGuardAllowed({
          absPath: sourceAbs,
          relPath: sourcePath,
          allowGuarded,
        });
        if (metadata.kind === "file") {
          verifyExpectedHash({
            relPath: sourcePath,
            actualHash: metadata.sha256,
            expectedHash: expectedSourceHash,
          });
        }
        if (metadata.kind === "directory") {
          await assertNoGuardedDescendants({
            absPath: sourceAbs,
            relPath: sourcePath,
            allowGuarded,
          });
        }
        const checkpointResults = await checkpoints?.capturePaths([
          sourcePath,
          destinationPath,
        ]);
        try {
          await fs.mkdir(path.dirname(destinationAbs), { recursive: true });
          await fs.rename(sourceAbs, destinationAbs);
        } catch (err) {
          if (checkpointResults) checkpoints?.discardCaptures(checkpointResults);
          throw err;
        }
        return {
          ok: true as const,
          sourcePath: normalizeInputPath(sourcePath),
          destinationPath: normalizeInputPath(destinationPath),
          kind: metadata.kind,
          ...(checkpointResults ? { checkpoints: checkpointResults } : {}),
        };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export function createCopyTool(
  workspaceRoot?: string,
  checkpoints?: RunCheckpointManager,
) {
  return tool({
    description:
      "Copy a workspace file or directory without overwriting the destination. Regular source files require expectedSourceHash. Requires approval.",
    inputSchema: z.object({
      sourcePath: z.string().describe("Existing source path relative to the workspace root."),
      destinationPath: z
        .string()
        .describe("New destination path relative to the workspace root. Must not already exist."),
      expectedSourceHash: z
        .string()
        .optional()
        .describe("Required for regular source files. SHA-256 from stat or read_file."),
      recursive: z
        .boolean()
        .optional()
        .describe("Required to copy directories. Defaults to false."),
      allowGuarded: allowGuardedSchema,
    }),
    execute: async ({
      sourcePath,
      destinationPath,
      expectedSourceHash,
      recursive = false,
      allowGuarded = false,
    }) => {
      try {
        assertPathGuardAllowed({ relPath: destinationPath, allowGuarded });
        const sourceAbs = resolveInWorkspace(sourcePath, workspaceRoot);
        const destinationAbs = resolveInWorkspace(destinationPath, workspaceRoot);
        await assertDestinationMissing(destinationAbs, destinationPath);
        const metadata = await assertGuardAllowed({
          absPath: sourceAbs,
          relPath: sourcePath,
          allowGuarded,
        });
        if (metadata.kind === "file") {
          verifyExpectedHash({
            relPath: sourcePath,
            actualHash: metadata.sha256,
            expectedHash: expectedSourceHash,
          });
          const checkpoint = await checkpoints?.capturePath(destinationPath);
          try {
            await fs.mkdir(path.dirname(destinationAbs), { recursive: true });
            await fs.copyFile(sourceAbs, destinationAbs, fsConstants.COPYFILE_EXCL);
          } catch (err) {
            if (checkpoint) checkpoints?.discardCaptures([checkpoint]);
            throw err;
          }
          return {
            ok: true as const,
            sourcePath: normalizeInputPath(sourcePath),
            destinationPath: normalizeInputPath(destinationPath),
            kind: metadata.kind,
            ...(checkpoint ? { checkpoint } : {}),
          };
        } else if (metadata.kind === "directory") {
          if (!recursive) {
            throw new Error("recursive: true is required to copy directories");
          }
          await assertNoGuardedDescendants({
            absPath: sourceAbs,
            relPath: sourcePath,
            allowGuarded,
          });
          const checkpoint = await checkpoints?.capturePath(destinationPath);
          try {
            await fs.cp(sourceAbs, destinationAbs, {
              recursive: true,
              errorOnExist: true,
              force: false,
            });
          } catch (err) {
            if (checkpoint) checkpoints?.discardCaptures([checkpoint]);
            throw err;
          }
          return {
            ok: true as const,
            sourcePath: normalizeInputPath(sourcePath),
            destinationPath: normalizeInputPath(destinationPath),
            kind: metadata.kind,
            ...(checkpoint ? { checkpoint } : {}),
          };
        } else {
          throw new Error(`copy is not supported for ${metadata.kind} paths`);
        }
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

export const readDirTool = createReadDirTool();
export const statTool = createStatTool();
export const mkdirTool = createMkdirTool();
export const deleteTool = createDeleteTool();
export const renameTool = createRenameTool();
export const copyTool = createCopyTool();

function entryKind(entry: import("node:fs").Dirent): "file" | "directory" | "symlink" | "other" {
  if (entry.isFile()) return "file";
  if (entry.isDirectory()) return "directory";
  if (entry.isSymbolicLink()) return "symlink";
  return "other";
}

async function assertDestinationMissing(
  absPath: string,
  relPath: string,
): Promise<void> {
  try {
    await fs.access(absPath);
  } catch (err) {
    if (isNotFound(err)) return;
    throw err;
  }
  throw new Error(`destination already exists: ${relPath}`);
}

function normalizeInputPath(relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  return normalized === "" ? "." : normalized;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
