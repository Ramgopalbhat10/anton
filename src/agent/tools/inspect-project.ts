import { tool } from "ai";
import { z } from "zod";

import {
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
} from "../sandbox";
import { inspectProjectAtPath } from "@/src/workspace/project-inspect";

export function createInspectProjectTool(workspaceRoot?: string) {
  return tool({
    description:
      "Inspect the active project before coding. Summarizes package manager, scripts, key dependencies, noteworthy files, and git state without modifying files.",
    inputSchema: z.object({}),
    execute: async () => {
      const root = workspaceRoot
        ? ensureWorkspaceRootAt(workspaceRoot)
        : ensureWorkspaceRoot();
      const result = inspectProjectAtPath(root);
      return {
        ok: true as const,
        ...result,
      };
    },
  });
}

export const inspectProjectTool = createInspectProjectTool();
