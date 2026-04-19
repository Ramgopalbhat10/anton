import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.warn(
    "[providers] OPENROUTER_API_KEY is not set — requests to /api/chat will fail.",
  );
}

export const openrouter = createOpenRouter({
  apiKey: apiKey ?? "",
});

export const DEFAULT_MODEL =
  process.env.DEFAULT_MODEL ?? "anthropic/claude-sonnet-4.5";

export const MODEL_CATALOG = [
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "openai/gpt-5", label: "GPT-5" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
] as const;

export type ModelId = (typeof MODEL_CATALOG)[number]["id"];
