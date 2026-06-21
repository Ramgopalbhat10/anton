import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveInWorkspace,
  SandboxError,
  workspaceRelative,
  workspaceRelativeTo,
} from "./sandbox";

const SKILL_FILE = "SKILL.md";
const MAX_SKILL_BYTES = 128 * 1024;
const SKILL_SLUG_RE = /^[a-z0-9_-]+$/;

const LOCAL_SKILL_DIRS = [
  "skills",
  ".agents/skills",
] as const;

export type SkillSummary = {
  slug: string;
  name: string;
  description: string;
  path: string;
  updatedAt: string;
};

export type SkillDocument = SkillSummary & {
  body: string;
};

export type SkillList = {
  skills: SkillSummary[];
  warnings: string[];
};

export type ComposerSkillSource = "local" | "global";

export type ComposerSkillSummary = {
  source: ComposerSkillSource;
  slug: string;
  name: string;
  description: string;
  command: string;
  path: string;
  updatedAt: string;
};

export type ComposerSkillDocument = SkillDocument & {
  source: ComposerSkillSource;
  command: string;
};

export type ComposerSkillList = {
  skills: ComposerSkillSummary[];
  warnings: string[];
};

export class SkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillError";
  }
}

export function listSkills(workspaceRoot?: string): SkillList {
  const skillsBySlug = new Map<string, SkillSummary>();
  const warnings: string[] = [];

  for (const dir of LOCAL_SKILL_DIRS) {
    const root = resolveInWorkspace(dir, workspaceRoot);
    if (!fs.existsSync(root)) continue;
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) {
      warnings.push(`${dir} exists but is not a directory`);
      continue;
    }

    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (!isValidSkillSlug(entry.name)) {
        warnings.push(`skipping invalid skill slug: ${dir}/${entry.name}`);
        continue;
      }
      if (skillsBySlug.has(entry.name)) continue;
      try {
        skillsBySlug.set(
          entry.name,
          summarizeSkill(readSkill(entry.name, workspaceRoot)),
        );
      } catch (err) {
        warnings.push(errorMessage(err));
      }
    }
  }

  return {
    skills: [...skillsBySlug.values()].sort((left, right) =>
      left.slug.localeCompare(right.slug),
    ),
    warnings,
  };
}

export function listComposerSkills(workspaceRoot?: string): ComposerSkillList {
  const warnings: string[] = [];
  const byCommand = new Map<string, ComposerSkillSummary>();

  if (workspaceRoot) {
    try {
      const local = listSkills(workspaceRoot);
      warnings.push(...local.warnings);
      for (const skill of local.skills) {
        const command = commandForSkillSlug(skill.slug);
        byCommand.set(command, {
          source: "local",
          slug: skill.slug,
          name: skill.name,
          description: skill.description,
          command,
          path: skill.path,
          updatedAt: skill.updatedAt,
        });
      }
    } catch (err) {
      warnings.push(errorMessage(err));
    }
  }

  for (const root of globalSkillRoots()) {
    const global = listGlobalSkills(root);
    warnings.push(...global.warnings);
    for (const skill of global.skills) {
      if (byCommand.has(skill.command)) continue;
      byCommand.set(skill.command, skill);
    }
  }

  return {
    skills: [...byCommand.values()].sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === "local" ? -1 : 1;
      }
      return left.command.localeCompare(right.command);
    }),
    warnings,
  };
}

export function readComposerSkill(
  command: string,
  workspaceRoot?: string,
): ComposerSkillDocument {
  const slug = normalizeCommandSlug(command);
  if (workspaceRoot) {
    try {
      const local = readSkill(slug, workspaceRoot);
      return { ...local, source: "local", command: commandForSkillSlug(local.slug) };
    } catch {
      // Fall through to installed global skills.
    }
  }

  for (const root of globalSkillRoots()) {
    const skill = readGlobalSkill(root, slug);
    if (skill) return skill;
  }

  throw new SkillError(`composer skill not found: ${command}`);
}

export function readSkill(slug: string, workspaceRoot?: string): SkillDocument {
  validateSkillSlug(slug);
  for (const dir of LOCAL_SKILL_DIRS) {
    const relPath = path.posix.join(dir, slug, SKILL_FILE);
    const abs = resolveInWorkspace(relPath, workspaceRoot);
    if (!fs.existsSync(abs)) continue;
    return readSkillFile({ slug, relPath, abs, workspaceRoot });
  }

  throw new SkillError(`skill not found: ${slug}`);
}

function readSkillFile({
  slug,
  relPath,
  abs,
  workspaceRoot,
}: {
  slug: string;
  relPath: string;
  abs: string;
  workspaceRoot?: string;
}): SkillDocument {
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
    path: skillDisplayPath(abs, workspaceRoot),
    raw: fs.readFileSync(abs, "utf8"),
    updatedAt: stat.mtime.toISOString(),
  });
}

function listGlobalSkills(root: GlobalSkillRoot): ComposerSkillList {
  if (!fs.existsSync(root.path)) return { skills: [], warnings: [] };
  let entries: fs.Dirent[];
  try {
    entries = fs
      .readdirSync(root.path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    return { skills: [], warnings: [errorMessage(err)] };
  }

  const skills: ComposerSkillSummary[] = [];
  const warnings: string[] = [];
  for (const entry of entries) {
    if (!isValidSkillSlug(entry.name)) {
      warnings.push(`skipping invalid installed skill slug: ${entry.name}`);
      continue;
    }

    const skillPath = path.join(root.path, entry.name, SKILL_FILE);
    try {
      const stat = fs.statSync(skillPath);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_SKILL_BYTES) {
        warnings.push(
          `installed skill too large: ${root.label}/${entry.name}/${SKILL_FILE}`,
        );
        continue;
      }
      const skill = parseSkill({
        slug: entry.name,
        path: `${root.label}/${entry.name}/${SKILL_FILE}`,
        raw: fs.readFileSync(skillPath, "utf8"),
        updatedAt: stat.mtime.toISOString(),
      });
      skills.push({
        source: "global",
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        command: commandForSkillSlug(skill.slug),
        path: skill.path,
        updatedAt: skill.updatedAt,
      });
    } catch (err) {
      warnings.push(errorMessage(err));
    }
  }

  return { skills, warnings };
}

function readGlobalSkill(
  root: GlobalSkillRoot,
  slug: string,
): ComposerSkillDocument | undefined {
  if (!isValidSkillSlug(slug)) return undefined;
  const skillPath = path.join(root.path, slug, SKILL_FILE);
  if (!fs.existsSync(skillPath)) return undefined;
  const stat = fs.statSync(skillPath);
  if (!stat.isFile()) return undefined;
  if (stat.size > MAX_SKILL_BYTES) {
    throw new SkillError(
      `installed skill too large (${stat.size} bytes, cap ${MAX_SKILL_BYTES})`,
    );
  }
  const skill = parseSkill({
    slug,
    path: `${root.label}/${slug}/${SKILL_FILE}`,
    raw: fs.readFileSync(skillPath, "utf8"),
    updatedAt: stat.mtime.toISOString(),
  });
  return {
    ...skill,
    source: "global",
    command: commandForSkillSlug(skill.slug),
  };
}

type GlobalSkillRoot = {
  path: string;
  label: string;
};

function globalSkillRoots(): GlobalSkillRoot[] {
  const home = os.homedir();
  return [
    {
      path: path.join(home, ".agents", "skills"),
      label: "~/.agents/skills",
    },
    {
      path: path.join(home, ".codex", "skills", ".system"),
      label: "~/.codex/skills/.system",
    },
  ];
}

function commandForSkillSlug(slug: string): string {
  return `/${slug}`;
}

function normalizeCommandSlug(command: string): string {
  const trimmed = command.trim();
  return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
}

function parseSkill({
  slug,
  path,
  raw,
  updatedAt,
}: {
  slug: string;
  path: string;
  raw: string;
  updatedAt: string;
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
    updatedAt,
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
    updatedAt: skill.updatedAt,
  };
}

function validateSkillSlug(slug: string): void {
  if (!isValidSkillSlug(slug)) {
    throw new SkillError(
      "skill slug must contain only lowercase letters, numbers, underscores, and hyphens",
    );
  }
}

function skillDisplayPath(absPath: string, workspaceRoot?: string): string {
  const relativePath = workspaceRoot
    ? workspaceRelativeTo(workspaceRoot, absPath)
    : workspaceRelative(absPath);
  return relativePath.split(path.sep).join("/");
}

function isValidSkillSlug(slug: string): boolean {
  return SKILL_SLUG_RE.test(slug);
}

function errorMessage(err: unknown): string {
  if (err instanceof SandboxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
