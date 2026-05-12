import { tool } from "ai";
import { z } from "zod";

const TODO_LIMIT = 40;

const todoStatusSchema = z.enum(["pending", "in_progress", "completed"]);

const todoItemSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .describe("Stable todo identifier, reused across updates."),
  text: z.string().min(1).max(240).describe("Short human-readable todo text."),
  status: todoStatusSchema,
});

export function createUpdateTodosTool() {
  return tool({
    description:
      "Publish the current implementation todo checklist. Sends the full current snapshot every time. Use during normal implementation turns for multi-step coding tasks.",
    inputSchema: z.object({
      items: z
        .array(todoItemSchema)
        .max(TODO_LIMIT)
        .describe("Full ordered todo snapshot for the current run."),
    }),
    execute: async ({ items }) => {
      const inProgressCount = items.filter(
        (item) => item.status === "in_progress",
      ).length;
      if (inProgressCount > 1) {
        return {
          ok: false as const,
          error: "Only one todo item can be in_progress.",
        };
      }

      return {
        ok: true as const,
        items: items.map((item) => ({
          id: item.id.trim(),
          text: item.text.replace(/\s+/g, " ").trim(),
          status: item.status,
        })),
      };
    },
  });
}

export const updateTodosTool = createUpdateTodosTool();
