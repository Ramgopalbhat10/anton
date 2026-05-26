import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import {
  getProviderId,
  resolveModelId,
} from "@/src/lib/models";
import {
  DEFAULT_MODEL,
  getLanguageModel,
} from "@/src/lib/providers";
import { listMemories } from "@/src/db/queries";
import { listSkills } from "../skills";
import {
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
  workspaceRelative,
} from "../sandbox";
import { createReadFileTool } from "./read-file";
import { createReadDirTool, createStatTool } from "./file-ops";
import { createGrepTool } from "./grep";
import { createGlobTool } from "./glob";
import { listMemoryTool } from "./memory";
import { createListSkillsTool, createReadSkillTool } from "./skills";

const DEFAULT_MAX_STEPS = 6;
const MAX_DELEGATE_STEPS = 10;

export function createDelegateTaskTool({
  model,
  workspaceRoot,
}: {
  model?: string;
  workspaceRoot?: string;
}) {
  const readOnlyTools = {
    read_file: createReadFileTool(workspaceRoot),
    read_dir: createReadDirTool(workspaceRoot),
    stat: createStatTool(workspaceRoot),
    grep: createGrepTool(workspaceRoot),
    glob: createGlobTool(workspaceRoot),
    list_memory: listMemoryTool,
    list_skills: createListSkillsTool(workspaceRoot),
    read_skill: createReadSkillTool(workspaceRoot),
  } as const;

  return tool({
    description:
      "Delegate a bounded read-only investigation to a child Anton agent. The child can read/search workspace files, memories, and skills, but cannot write files, run shell commands, or mutate memory.",
    inputSchema: z.object({
      task: z
        .string()
        .trim()
        .min(1)
        .max(4000)
        .describe("The specific read-only question or investigation to delegate."),
      maxSteps: z
        .number()
        .int()
        .min(1)
        .max(MAX_DELEGATE_STEPS)
        .optional()
        .describe(
          `Maximum child-agent tool-loop steps. Defaults to ${DEFAULT_MAX_STEPS}.`,
        ),
    }),
    execute: async ({ task, maxSteps }) => {
      try {
        const selectedModel = resolveModelId(model ?? DEFAULT_MODEL);
        const openRouterOptions =
          getProviderId(selectedModel) === "openrouter"
            ? {
                openrouter: {
                  usage: { include: true },
                },
              }
            : undefined;
        const result = await generateText({
          model: getLanguageModel(selectedModel),
          system: childSystemPrompt(workspaceRoot),
          prompt: task,
          tools: readOnlyTools,
          stopWhen: stepCountIs(maxSteps ?? DEFAULT_MAX_STEPS),
          ...(openRouterOptions ? { providerOptions: openRouterOptions } : {}),
        });

        return {
          ok: true as const,
          summary: result.text.trim(),
          stepsUsed: result.steps.length,
          totalTokens: result.totalUsage.totalTokens ?? 0,
        };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  });
}

function childSystemPrompt(workspaceRoot?: string): string {
  const root = workspaceRoot
    ? ensureWorkspaceRootAt(workspaceRoot)
    : ensureWorkspaceRoot();
  const rel = workspaceRelative(root);
  return [
    "You are a read-only Anton sub-agent. Investigate the delegated task and return a concise, evidence-backed summary for the parent agent.",
    "",
    `The workspace root is \`${rel === "." ? root : rel}\`. All file paths you pass to tools must be relative to this root.`,
    "You cannot write files, run shell commands, mutate memory, or request approvals.",
    "",
    "Available read-only tools:",
    "- `read_file(path, startLine?, endLine?)`",
    "- `read_dir(path?)`",
    "- `stat(path)`",
    "- `grep(pattern, path?, glob?, caseInsensitive?)`",
    "- `glob(pattern, path?)`",
    "- `list_memory(limit?)`",
    "- `list_skills()`",
    "- `read_skill(slug)`",
    "",
    ...projectMemoryPromptLines(),
    "",
    ...projectSkillPromptLines(workspaceRoot),
    "",
    "Return only the useful findings, including file paths or identifiers when they matter.",
  ].join("\n");
}

function projectMemoryPromptLines(): string[] {
  const memories = listMemories(10);
  if (memories.length === 0) {
    return ["Project memory:", "- No saved memories yet."];
  }
  return [
    "Project memory:",
    ...memories.map((memory) => `- [${memory.id}] ${memory.content}`),
  ];
}

function projectSkillPromptLines(workspaceRoot?: string): string[] {
  try {
    const { skills, warnings } = listSkills(workspaceRoot);
    const lines = ["Project skills:"];
    if (skills.length === 0) {
      lines.push("- No workspace skills found.");
    } else {
      lines.push(
        ...skills.map((skill) =>
          `- ${skill.slug}: ${skill.name}${skill.description ? ` - ${skill.description}` : ""}`,
        ),
      );
    }
    if (warnings.length > 0) {
      lines.push(`- Skill load warnings: ${warnings.length}`);
    }
    return lines;
  } catch (err) {
    return [
      "Project skills:",
      `- Skill discovery failed: ${errorMessage(err)}`,
    ];
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
