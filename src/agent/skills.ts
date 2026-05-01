import fs from "node:fs";
import path from "node:path";
import { resolveInWorkspace, SandboxError, workspaceRelative } from "./sandbox";

const SKILLS_DIR = "skills";
const SKILL_FILE = "SKILL.md";
const MAX_SKILL_BYTES = 128 * 1024;
const SKILL_SLUG_RE = /^[a-z0-9_-]+$/;

export type SkillSummary = {
  slug: string;
  name: string;
  description: string;
  path: string;
};

export type SkillDocument = SkillSummary & {
  body: string;
};

export type SkillList = {
  skills: SkillSummary[];
  warnings: string[];
};

export class SkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillError";
  }
}

export function listSkills(workspaceRoot?: string): SkillList {
  const root = resolveInWorkspace(SKILLS_DIR, workspaceRoot);
  if (!fs.existsSync(root)) return { skills: [], warnings: [] };
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    throw new SkillError(`${SKILLS_DIR} exists but is not a directory`);
  }

  const skills: SkillSummary[] = [];
  const warnings: string[] = [];
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (!isValidSkillSlug(entry.name)) {
      warnings.push(`skipping invalid skill slug: ${entry.name}`);
      continue;
    }
    try {
      skills.push(summarizeSkill(readSkill(entry.name, workspaceRoot)));
    } catch (err) {
      warnings.push(errorMessage(err));
    }
  }

  return { skills, warnings };
}

export function readSkill(slug: string, workspaceRoot?: string): SkillDocument {
  validateSkillSlug(slug);
  const relPath = path.posix.join(SKILLS_DIR, slug, SKILL_FILE);
  const abs = resolveInWorkspace(relPath, workspaceRoot);
  const stat = fs.statSync(abs);
  if (!stat.isFile()) {
    throw new SkillError(`not a skill file: ${relPath}`);
  }
  if (stat.size > MAX_SKILL_BYTES) {
    throw new SkillError(
      `skill too large (${stat.size} bytes, cap ${MAX_SKILL_BYTES})`,
    );
  }

  return parseSkill({
    slug,
    path: workspaceRelative(abs).split(path.sep).join("/"),
    raw: fs.readFileSync(abs, "utf8"),
  });
}

function parseSkill({
  slug,
  path,
  raw,
}: {
  slug: string;
  path: string;
  raw: string;
}): SkillDocument {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const { metadata, body } = splitFrontmatter(normalized);
  const fallbackName = titleFromBody(body) ?? slug;

  return {
    slug,
    path,
    name: metadata.name ?? fallbackName,
    description: metadata.description ?? "",
    body: body.trim(),
  };
}

function splitFrontmatter(raw: string): {
  metadata: { name?: string; description?: string };
  body: string;
} {
  if (!raw.startsWith("---\n")) return { metadata: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { metadata: {}, body: raw };

  const metadata: { name?: string; description?: string } = {};
  const frontmatter = raw.slice(4, end);
  for (const line of frontmatter.split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = unquote(line.slice(sep + 1).trim());
    if (key === "name" && value) metadata.name = value;
    if (key === "description" && value) metadata.description = value;
  }

  return { metadata, body: raw.slice(end + "\n---\n".length) };
}

function titleFromBody(body: string): string | undefined {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
  }
  return undefined;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function summarizeSkill(skill: SkillDocument): SkillSummary {
  return {
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    path: skill.path,
  };
}

function validateSkillSlug(slug: string): void {
  if (!isValidSkillSlug(slug)) {
    throw new SkillError(
      "skill slug must contain only lowercase letters, numbers, underscores, and hyphens",
    );
  }
}

function isValidSkillSlug(slug: string): boolean {
  return SKILL_SLUG_RE.test(slug);
}

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
