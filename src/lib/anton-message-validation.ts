import { z } from "zod";

import type { AntonUIMessage } from "@/src/lib/trace";

const MESSAGE_ROLES = ["system", "user", "assistant"] as const;
const TOOL_PART_RE = /^tool-[A-Za-z0-9_-]+$/;
const DATA_PART_RE = /^data-[A-Za-z0-9_-]+$/;
const KNOWN_STRUCTURAL_PARTS = new Set([
  "step-start",
  "source-url",
  "source-document",
  "file",
]);

const antonUIPartSchema = z
  .record(z.string(), z.unknown())
  .superRefine((part, ctx) => {
    const type = part.type;
    if (typeof type !== "string" || type.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["type"],
        message: "message part type is required",
      });
      return;
    }

    if (type === "text") {
      if (typeof part.text !== "string") {
        ctx.addIssue({
          code: "custom",
          path: ["text"],
          message: "text part requires string text",
        });
      }
      return;
    }

    if (type === "reasoning") {
      if (part.text !== undefined && typeof part.text !== "string") {
        ctx.addIssue({
          code: "custom",
          path: ["text"],
          message: "reasoning text must be a string when present",
        });
      }
      return;
    }

    if (DATA_PART_RE.test(type)) {
      if (part.id !== undefined && typeof part.id !== "string") {
        ctx.addIssue({
          code: "custom",
          path: ["id"],
          message: "data part id must be a string when present",
        });
      }
      if (!Object.prototype.hasOwnProperty.call(part, "data")) {
        ctx.addIssue({
          code: "custom",
          path: ["data"],
          message: "data part requires data",
        });
      }
      return;
    }

    if (TOOL_PART_RE.test(type) || type === "dynamic-tool") {
      if (type === "dynamic-tool" && typeof part.toolName !== "string") {
        ctx.addIssue({
          code: "custom",
          path: ["toolName"],
          message: "dynamic tool part requires string toolName",
        });
      }
      if (part.toolCallId !== undefined && typeof part.toolCallId !== "string") {
        ctx.addIssue({
          code: "custom",
          path: ["toolCallId"],
          message: "tool part toolCallId must be a string when present",
        });
      }
      if (part.state !== undefined && typeof part.state !== "string") {
        ctx.addIssue({
          code: "custom",
          path: ["state"],
          message: "tool part state must be a string when present",
        });
      }
      if (part.errorText !== undefined && typeof part.errorText !== "string") {
        ctx.addIssue({
          code: "custom",
          path: ["errorText"],
          message: "tool part errorText must be a string when present",
        });
      }
      return;
    }

    if (type === "file") {
      if (typeof part.mediaType !== "string" || part.mediaType.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["mediaType"],
          message: "file part requires string mediaType",
        });
      }
      if (typeof part.url !== "string" || part.url.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["url"],
          message: "file part requires string url",
        });
      }
      if (part.filename !== undefined && typeof part.filename !== "string") {
        ctx.addIssue({
          code: "custom",
          path: ["filename"],
          message: "file part filename must be a string when present",
        });
      }
      return;
    }

    if (KNOWN_STRUCTURAL_PARTS.has(type)) return;

    ctx.addIssue({
      code: "custom",
      path: ["type"],
      message: `unsupported message part type: ${type}`,
    });
  });

export const antonUIMessagesSchema = z
  .array(
    z
      .object({
        id: z.string().min(1),
        role: z.enum(MESSAGE_ROLES),
        parts: z.array(antonUIPartSchema).min(1),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  )
  .min(1);

export function parseAntonUIMessages(value: unknown):
  | { ok: true; messages: AntonUIMessage[] }
  | { ok: false; issues: z.core.$ZodIssue[] } {
  const parsed = antonUIMessagesSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues };
  }
  return { ok: true, messages: parsed.data as unknown as AntonUIMessage[] };
}
