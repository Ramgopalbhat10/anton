export const DEFAULT_MODEL_ID = "anthropic/claude-sonnet-4.5";

export const MODEL_CATALOG = [
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "openai/gpt-5", label: "GPT-5" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
] as const;

export type ModelId = (typeof MODEL_CATALOG)[number]["id"];

export function isSupportedModelId(modelId: string): modelId is ModelId {
  return MODEL_CATALOG.some((model) => model.id === modelId);
}
