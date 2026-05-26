import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

import {
  DEFAULT_MODEL_ID,
  getProviderId,
  getProviderModelId,
  resolveModelId,
} from "./models";

const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go";

const opencodeApiKey = process.env.OPENCODE_GO_API_KEY;
const openrouterApiKey = process.env.OPENROUTER_API_KEY;

if (!opencodeApiKey) {
  console.warn(
    "[providers] OPENCODE_GO_API_KEY is not set — OpenCode Go requests will fail.",
  );
}

if (!openrouterApiKey) {
  console.warn(
    "[providers] OPENROUTER_API_KEY is not set — OpenRouter requests will fail.",
  );
}

const chatCompletionsProvider = createOpenAICompatible({
  name: "opencode-go",
  baseURL: `${OPENCODE_GO_BASE_URL}/v1`,
  apiKey: opencodeApiKey ?? "",
});

const messagesProvider = createAnthropic({
  baseURL: OPENCODE_GO_BASE_URL,
  apiKey: opencodeApiKey ?? "",
});

export const openrouter = createOpenRouter({
  apiKey: openrouterApiKey ?? "",
});

const ANTHROPIC_ENDPOINT_MODELS = new Set([
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.6-plus",
  "qwen3.5-plus",
]);

const OPENROUTER_ROUTING_SUFFIXES = new Set(["floor", "free", "nitro"]);

export function stripOpenRouterRoutingSuffix(modelId: string): string {
  const suffix = openRouterRoutingSuffix(modelId);
  return suffix ? modelId.slice(0, -suffix.length - 1) : modelId;
}

function openRouterRoutingSuffix(modelId: string): string | null {
  const suffix = modelId.split(":").at(-1);
  if (!suffix || suffix === modelId) return null;
  return OPENROUTER_ROUTING_SUFFIXES.has(suffix) ? suffix : null;
}

export function getLanguageModel(modelId: string): LanguageModel {
  const resolved = resolveModelId(modelId);
  const provider = getProviderId(resolved);
  const providerModelId = getProviderModelId(resolved);

  if (provider === "openrouter") {
    return openrouter(stripOpenRouterRoutingSuffix(providerModelId));
  }

  if (ANTHROPIC_ENDPOINT_MODELS.has(providerModelId)) {
    return messagesProvider(providerModelId);
  }

  return chatCompletionsProvider.chatModel(providerModelId);
}

export const DEFAULT_MODEL = resolveModelId(
  process.env.DEFAULT_MODEL ?? DEFAULT_MODEL_ID,
);
