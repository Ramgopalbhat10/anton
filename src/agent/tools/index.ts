import type { ToolSet } from "ai";
import { createReadFileTool, readFileTool } from "./read-file";
import { createWriteFileTool, writeFileTool } from "./write-file";
import { bashTool, createBashTool } from "./bash";
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

export const nativeAntonTools = {
  read_file: readFileTool,
  write_file: writeFileTool,
  bash: bashTool,
  grep: grepTool,
  glob: globTool,
  list_memory: listMemoryTool,
  remember: rememberTool,
  update_memory: updateMemoryTool,
  forget_memory: forgetMemoryTool,
  list_skills: listSkillsTool,
  read_skill: readSkillTool,
} as const;

export function createAntonTools({
  model,
  mcpTools,
  workspaceRoot,
}: {
  model?: string;
  mcpTools?: ToolSet;
  workspaceRoot?: string;
}) {
  return {
    ...nativeAntonTools,
    read_file: createReadFileTool(workspaceRoot),
    write_file: createWriteFileTool(workspaceRoot),
    bash: createBashTool(workspaceRoot),
    grep: createGrepTool(workspaceRoot),
    glob: createGlobTool(workspaceRoot),
    list_skills: createListSkillsTool(workspaceRoot),
    read_skill: createReadSkillTool(workspaceRoot),
    delegate_task: createDelegateTaskTool({ model, workspaceRoot }),
    ...(mcpTools ?? {}),
  };
}

export type AntonTools = ReturnType<typeof createAntonTools>;
