import { readFileTool } from "./read-file";
import { writeFileTool } from "./write-file";
import { bashTool } from "./bash";
import { grepTool } from "./grep";
import { globTool } from "./glob";

export const antonTools = {
  read_file: readFileTool,
  write_file: writeFileTool,
  bash: bashTool,
  grep: grepTool,
  glob: globTool,
} as const;

export type AntonTools = typeof antonTools;
