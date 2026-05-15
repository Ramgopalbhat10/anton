import type { ToolSet } from "ai";
import {
  applyNativeToolPermissionPolicy,
  stripApprovalFlags,
  type PermissionMode,
} from "../permissions";
import { createReadFileTool, readFileTool } from "./read-file";
import { createEditFileTool, editFileTool } from "./edit-file";
import { createWriteFileTool, writeFileTool } from "./write-file";
import { bashTool, createBashTool } from "./bash";
import {
  createInspectProjectTool,
  inspectProjectTool,
} from "./inspect-project";
import {
  copyTool,
  createCopyTool,
  createDeleteTool,
  createMkdirTool,
  createReadDirTool,
  createRenameTool,
  createStatTool,
  deleteTool,
  mkdirTool,
  readDirTool,
  renameTool,
  statTool,
} from "./file-ops";
import { createFormatTool, formatTool } from "./format";
import {
  createGitBranchTool,
  createGitCommitTool,
  createGitDiffTool,
  createGitRestoreTool,
  createGitShowTool,
  createGitStatusTool,
  createRevertChangesTool,
  gitBranchTool,
  gitCommitTool,
  gitDiffTool,
  gitRestoreTool,
  gitShowTool,
  gitStatusTool,
  revertChangesTool,
} from "./git";
import { createGrepTool, grepTool } from "./grep";
import { createGlobTool, globTool } from "./glob";
import {
  forgetMemoryTool,
  listMemoryTool,
  rememberTool,
  updateMemoryTool,
} from "./memory";
import {
  createListSkillsTool,
  createReadSkillTool,
  listSkillsTool,
  readSkillTool,
} from "./skills";
import { createDelegateTaskTool } from "./delegate";
import { createUpdateTodosTool, updateTodosTool } from "./todos";
import { createVerifyTool, verifyTool } from "./verify";

export const nativeAntonTools = applyNativeToolPermissionPolicy({
  read_file: readFileTool,
  edit_file: editFileTool,
  write_file: writeFileTool,
  read_dir: readDirTool,
  stat: statTool,
  mkdir: mkdirTool,
  delete: deleteTool,
  rename: renameTool,
  copy: copyTool,
  format: formatTool,
  git_status: gitStatusTool,
  git_diff: gitDiffTool,
  git_show: gitShowTool,
  git_branch: gitBranchTool,
  git_commit: gitCommitTool,
  git_restore: gitRestoreTool,
  revert_changes: revertChangesTool,
  bash: bashTool,
  inspect_project: inspectProjectTool,
  verify: verifyTool,
  grep: grepTool,
  glob: globTool,
  list_memory: listMemoryTool,
  remember: rememberTool,
  update_memory: updateMemoryTool,
  forget_memory: forgetMemoryTool,
  list_skills: listSkillsTool,
  read_skill: readSkillTool,
  delegate_task: createDelegateTaskTool({}),
  update_todos: updateTodosTool,
} as const);

export type NativeAntonToolName = keyof typeof nativeAntonTools;

export const NATIVE_ANTON_TOOL_NAMES = Object.keys(
  nativeAntonTools,
) as NativeAntonToolName[];

type ToolExecutionCache = Map<string, Promise<unknown>>;
type InFlightToolExecutionCache = Map<string, Promise<unknown>>;

export function createAntonTools({
  model,
  mcpTools,
  workspaceRoot,
  permissionMode,
  nativeToolNames,
  includeMcpTools = true,
  executionCache,
}: {
  model?: string;
  mcpTools?: ToolSet;
  workspaceRoot?: string;
  permissionMode?: PermissionMode;
  nativeToolNames?: readonly NativeAntonToolName[];
  includeMcpTools?: boolean;
  executionCache?: ToolExecutionCache;
}) {
  const selectedNativeToolNames = new Set(
    nativeToolNames ?? NATIVE_ANTON_TOOL_NAMES,
  );
  const allNativeTools = {
    ...nativeAntonTools,
    read_file: createReadFileTool(workspaceRoot),
    edit_file: createEditFileTool(workspaceRoot),
    write_file: createWriteFileTool(workspaceRoot),
    read_dir: createReadDirTool(workspaceRoot),
    stat: createStatTool(workspaceRoot),
    mkdir: createMkdirTool(workspaceRoot),
    delete: createDeleteTool(workspaceRoot),
    rename: createRenameTool(workspaceRoot),
    copy: createCopyTool(workspaceRoot),
    format: createFormatTool(workspaceRoot),
    git_status: createGitStatusTool(workspaceRoot),
    git_diff: createGitDiffTool(workspaceRoot),
    git_show: createGitShowTool(workspaceRoot),
    git_branch: createGitBranchTool(workspaceRoot),
    git_commit: createGitCommitTool(workspaceRoot),
    git_restore: createGitRestoreTool(workspaceRoot),
    revert_changes: createRevertChangesTool(workspaceRoot),
    bash: createBashTool(workspaceRoot),
    inspect_project: createInspectProjectTool(workspaceRoot),
    verify: createVerifyTool(workspaceRoot),
    grep: createGrepTool(workspaceRoot),
    glob: createGlobTool(workspaceRoot),
    list_skills: createListSkillsTool(workspaceRoot),
    read_skill: createReadSkillTool(workspaceRoot),
    delegate_task: createDelegateTaskTool({ model, workspaceRoot }),
    update_todos: createUpdateTodosTool(),
  } satisfies Record<NativeAntonToolName, ToolSet[string]>;

  const nativeTools = applyNativeToolPermissionPolicy(
    Object.fromEntries(
      NATIVE_ANTON_TOOL_NAMES
        .filter((name) => selectedNativeToolNames.has(name))
        .map((name) => [name, allNativeTools[name]]),
    ) as ToolSet,
    permissionMode,
  );

  return withExecutionCache({
    ...nativeTools,
    ...(includeMcpTools && permissionMode === "full-access" && mcpTools
      ? stripApprovalFlags(mcpTools)
      : includeMcpTools
        ? (mcpTools ?? {})
        : {}),
  }, executionCache);
}

export type AntonTools = ReturnType<typeof createAntonTools>;

function withExecutionCache(
  tools: ToolSet,
  cache: ToolExecutionCache = new Map(),
): ToolSet {
  const inFlightByInput: InFlightToolExecutionCache = new Map();
  return Object.fromEntries(
    Object.entries(tools).map(([name, toolValue]) => {
      const candidate = toolValue as ToolSet[string] & {
        execute?: (
          input: unknown,
          options: { toolCallId: string; [key: string]: unknown },
        ) => unknown;
      };
      if (typeof candidate.execute !== "function") return [name, toolValue];
      const execute = candidate.execute;

      return [
        name,
        {
          ...toolValue,
          execute: (
            input: unknown,
          options: { toolCallId: string; [key: string]: unknown },
        ) => {
          const key = `${name}:${options.toolCallId}`;
          const existing = cache.get(key);
          if (existing) return existing;
          const inputKey = `${name}:${stableJson(input)}`;
          const matchingInFlight = inFlightByInput.get(inputKey);
          if (matchingInFlight) {
            cache.set(key, matchingInFlight);
            return matchingInFlight;
          }
          const result = Promise.resolve(execute(input, options)).finally(() => {
            inFlightByInput.delete(inputKey);
          });
          cache.set(key, result);
          inFlightByInput.set(inputKey, result);
          return result;
        },
      },
      ];
    }),
  ) as ToolSet;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
