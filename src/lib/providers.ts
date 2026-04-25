import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { DEFAULT_MODEL_ID } from "./models";

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
  process.env.DEFAULT_MODEL ?? DEFAULT_MODEL_ID;
