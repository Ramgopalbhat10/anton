import { readFileTool } from "./read-file";
import { writeFileTool } from "./write-file";
import { bashTool } from "./bash";
import { grepTool } from "./grep";
import { globTool } from "./glob";
import {
  forgetMemoryTool,
  listMemoryTool,
  rememberTool,
} from "./memory";
import { listSkillsTool, readSkillTool } from "./skills";

export const antonTools = {
  read_file: readFileTool,
  write_file: writeFileTool,
  bash: bashTool,
  grep: grepTool,
  glob: globTool,
  list_memory: listMemoryTool,
  remember: rememberTool,
  forget_memory: forgetMemoryTool,
  list_skills: listSkillsTool,
  read_skill: readSkillTool,
} as const;

export type AntonTools = typeof antonTools;
