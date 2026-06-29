import { tool } from "ai";
import { z } from "zod";

import {
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
} from "../sandbox";
import { inspectProjectAtPath, type ProjectInspectResult } from "@/src/workspace/project-inspect";

type InspectFingerprint = {
  packageManager: string;
  scripts: string;
  keyDependencies: string;
  noteworthyFiles: string;
  branch: string;
  dirtyFileCount: number;
  dirtyFiles: string;
};

type InspectCacheEntry = {
  result: ProjectInspectResult;
  fingerprint: InspectFingerprint;
};

const inspectCache = new Map<string, InspectCacheEntry>();

export function createInspectProjectTool(workspaceRoot?: string) {
  return tool({
    description:
      "Inspect the active project before coding. Summarizes package manager, scripts, key dependencies, noteworthy files, and git state without modifying files. When the project state is unchanged since the last inspect in this process, returns a compact cached digest instead of the full payload.",
    inputSchema: z.object({}),
    execute: async () => {
      const root = workspaceRoot
        ? ensureWorkspaceRootAt(workspaceRoot)
        : ensureWorkspaceRoot();
      const result = inspectProjectAtPath(root);
      const fingerprint = fingerprintOf(result);
      const cached = inspectCache.get(root);
      if (cached && fingerprintsEqual(cached.fingerprint, fingerprint)) {
        return {
          ok: true as const,
          cached: true as const,
          summary: result.summary,
        };
      }
      inspectCache.set(root, { result, fingerprint });
      return {
        ok: true as const,
        ...result,
      };
    },
  });
}

function fingerprintOf(result: ProjectInspectResult): InspectFingerprint {
  return {
    packageManager: result.packageManager ?? "none",
    scripts: result.scripts.join(","),
    keyDependencies: result.keyDependencies.join(","),
    noteworthyFiles: result.noteworthyFiles.join(","),
    branch: result.git.branch ?? "",
    dirtyFileCount: result.git.dirtyFileCount,
    dirtyFiles: result.git.dirtyFiles.join(","),
  };
}

function fingerprintsEqual(
  left: InspectFingerprint,
  right: InspectFingerprint,
): boolean {
  return (
    left.packageManager === right.packageManager &&
    left.scripts === right.scripts &&
    left.keyDependencies === right.keyDependencies &&
    left.noteworthyFiles === right.noteworthyFiles &&
    left.branch === right.branch &&
    left.dirtyFileCount === right.dirtyFileCount &&
    left.dirtyFiles === right.dirtyFiles
  );
}

export const inspectProjectTool = createInspectProjectTool();
