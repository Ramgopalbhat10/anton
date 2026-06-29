import fs from "node:fs";

import { listSkills } from "./skills";
import { resolveInWorkspace } from "./sandbox";

const INSTRUCTION_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
] as const;

const MAX_INSTRUCTION_FILE_CHARS = 18_000;
const MAX_INSTRUCTION_TOTAL_CHARS = 32_000;

type PromptDoc = {
  path: string;
  body: string;
  truncated: boolean;
};

export type WorkspacePromptContextSummary = {
  instructionFiles: {
    path: string;
    truncated: boolean;
  }[];
  skills: {
    slug: string;
    description: string;
    path: string;
  }[];
  skillWarnings: string[];
  error?: string;
};

export function workspaceInstructionPromptLines(
  workspaceRoot?: string,
): string[] {
  const docs = readInstructionDocs(workspaceRoot);
  const lines = [
    "Workspace instructions:",
    "Follow these repository instructions for workflow, conventions, and required process unless they conflict with Anton's system prompt, sandbox, or approval policy.",
  ];

  if (docs.length === 0) {
    lines.push("- No root AGENTS.md, CLAUDE.md, or GEMINI.md found.");
    return lines;
  }

  for (const doc of docs) {
    lines.push(
      "",
      `--- ${doc.path}${doc.truncated ? " (truncated)" : ""} ---`,
      doc.body,
      `--- end ${doc.path} ---`,
    );
  }

  return lines;
}

export function workspaceSkillPromptLines(workspaceRoot?: string): string[] {
  let result: ReturnType<typeof listSkills>;
  try {
    result = listSkills(workspaceRoot);
  } catch (err) {
    return [
      "Project skills:",
      `- Skill discovery failed: ${errorMessage(err)}`,
    ];
  }

  const { skills, warnings } = result;
  const lines = [
    "Available project skills:",
    "Skills provide specialized instructions and workflows for specific tasks. Use `read_skill` to load a skill when a task matches its description.",
  ];
  if (skills.length === 0) {
    lines.push("- No workspace skills found.");
  } else {
    lines.push("<available_skills>");
    for (const summary of skills) {
      lines.push(
        "  <skill>",
        `    <name>${escapeXml(summary.slug)}</name>`,
        `    <description>${escapeXml(summary.description || summary.name)}</description>`,
        `    <location>${escapeXml(summary.path)}</location>`,
        "  </skill>",
      );
    }
    lines.push("</available_skills>");
  }
  if (warnings.length > 0) {
    lines.push(`- Skill load warnings: ${warnings.length}`);
  }
  return lines;
}

export function workspacePromptContextSummary(
  workspaceRoot?: string,
): WorkspacePromptContextSummary {
  try {
    const instructionFiles = readInstructionDocs(workspaceRoot).map((doc) => ({
      path: doc.path,
      truncated: doc.truncated,
    }));
    const { skills, warnings } = listSkills(workspaceRoot);
    return {
      instructionFiles,
      skills: skills.map((skill) => ({
        slug: skill.slug,
        description: skill.description,
        path: skill.path,
      })),
      skillWarnings: warnings,
    };
  } catch (err) {
    return {
      instructionFiles: [],
      skills: [],
      skillWarnings: [],
      error: errorMessage(err),
    };
  }
}

function readInstructionDocs(workspaceRoot?: string): PromptDoc[] {
  const docs: PromptDoc[] = [];
  let remaining = MAX_INSTRUCTION_TOTAL_CHARS;

  for (const file of INSTRUCTION_FILES) {
    if (remaining <= 0) break;
    let abs: string;
    try {
      abs = resolveInWorkspace(file, workspaceRoot);
    } catch {
      continue;
    }
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (!stat.isFile()) continue;

    const raw = fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, "").trim();
    if (!raw) continue;
    const body = truncateText(raw, Math.min(MAX_INSTRUCTION_FILE_CHARS, remaining));
    docs.push({ path: file, body: body.text, truncated: body.truncated });
    remaining -= body.text.length;
  }

  return docs;
}

function truncateText(text: string, maxChars: number): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, Math.max(0, maxChars)).trimEnd()}\n...[truncated]`,
    truncated: true,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
