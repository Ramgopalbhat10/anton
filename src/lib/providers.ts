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

const OPENROUTER_ROUTING_SUFFIXES = new Set(["floor", "free", "nitro"]);

export const DEFAULT_MODEL = stripOpenRouterRoutingSuffix(
  process.env.DEFAULT_MODEL ?? DEFAULT_MODEL_ID,
);

export function toOpenRouterModelId(modelId: string): string {
  return hasOpenRouterRoutingSuffix(modelId) ? modelId : `${modelId}:floor`;
}

export function stripOpenRouterRoutingSuffix(modelId: string): string {
  const suffix = openRouterRoutingSuffix(modelId);
  return suffix ? modelId.slice(0, -suffix.length - 1) : modelId;
}

function hasOpenRouterRoutingSuffix(modelId: string): boolean {
  return openRouterRoutingSuffix(modelId) !== null;
}

function openRouterRoutingSuffix(modelId: string): string | null {
  const suffix = modelId.split(":").at(-1);
  if (!suffix || suffix === modelId) return null;
  return OPENROUTER_ROUTING_SUFFIXES.has(suffix) ? suffix : null;
}
