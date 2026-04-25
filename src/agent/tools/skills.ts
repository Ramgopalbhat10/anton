import { z } from "zod";
import { tool } from "ai";
import { listSkills, readSkill } from "../skills";

export const listSkillsTool = tool({
  description:
    "List project-local skills available under skills/<slug>/SKILL.md in the workspace.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      return { ok: true as const, ...listSkills() };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
});

export const readSkillTool = tool({
  description:
    "Read one project-local skill by slug. Call this before applying a matching skill.",
  inputSchema: z.object({
    slug: z
      .string()
      .regex(/^[a-z0-9_-]+$/)
      .describe("Skill slug from list_skills, e.g. code-review."),
  }),
  execute: async ({ slug }) => {
    try {
      return { ok: true as const, skill: readSkill(slug) };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
});

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
