import { z } from "zod";
import { tool } from "ai";
import {
  createMemory,
  deleteMemory,
  listMemories,
  updateMemory,
} from "@/src/db/queries";
import type { Memory } from "@/src/db/schema";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_MEMORY_CHARS = 1000;

export const listMemoryTool = tool({
  description:
    "List project-wide memories that Anton should use across sessions. Returns the most recently updated memories first.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe(`Maximum memories to return. Defaults to ${DEFAULT_LIMIT}.`),
  }),
  execute: async ({ limit }) => {
    try {
      return {
        ok: true as const,
        memories: listMemories(limit ?? DEFAULT_LIMIT).map(serializeMemory),
      };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
});

export const rememberTool = tool({
  description:
    "Save one concise project-wide memory for future Anton sessions. Requires user approval.",
  inputSchema: z.object({
    content: z
      .string()
      .trim()
      .min(1)
      .max(MAX_MEMORY_CHARS)
      .describe("A concise memory to preserve across sessions."),
  }),
  needsApproval: true,
  execute: async ({ content }) => {
    try {
      return {
        ok: true as const,
        memory: serializeMemory(createMemory(content)),
      };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
});

export const forgetMemoryTool = tool({
  description:
    "Delete one project-wide memory by ID. Use list_memory first if you need the ID. Requires user approval.",
  inputSchema: z.object({
    id: z.string().min(1).describe("The memory ID to delete."),
  }),
  needsApproval: true,
  execute: async ({ id }) => {
    try {
      const deleted = deleteMemory(id);
      if (!deleted) {
        return { ok: false as const, error: `memory not found: ${id}` };
      }
      return { ok: true as const, id };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
});

export const updateMemoryTool = tool({
  description:
    "Update one existing project-wide memory by ID. Use list_memory first if you need the ID. Requires user approval.",
  inputSchema: z.object({
    id: z.string().min(1).describe("The memory ID to update."),
    content: z
      .string()
      .trim()
      .min(1)
      .max(MAX_MEMORY_CHARS)
      .describe("Replacement memory content."),
  }),
  needsApproval: true,
  execute: async ({ id, content }) => {
    try {
      const memory = updateMemory(id, content);
      if (!memory) {
        return { ok: false as const, error: `memory not found: ${id}` };
      }
      return { ok: true as const, memory: serializeMemory(memory) };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  },
});

function serializeMemory(memory: Memory): {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
} {
  return {
    id: memory.id,
    content: memory.content,
    createdAt: memory.createdAt.getTime(),
    updatedAt: memory.updatedAt.getTime(),
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
