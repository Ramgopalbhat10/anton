export const PROVIDERS = [
  { id: "opencode-go", label: "OpenCode Go" },
  { id: "openrouter", label: "OpenRouter" },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

export const DEFAULT_PROVIDER_ID: ProviderId = "opencode-go";
export const DEFAULT_MODEL_ID = "opencode-go/deepseek-v4-flash";

export const OPENCODE_GO_MODELS = [
  { slug: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { slug: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { slug: "glm-5.2", label: "GLM 5.2" },
  { slug: "glm-5.1", label: "GLM 5.1" },
  { slug: "glm-5", label: "GLM 5" },
  { slug: "kimi-k2.7-code", label: "Kimi K2.7 Code" },
  { slug: "kimi-k2.6", label: "Kimi K2.6" },
  { slug: "kimi-k2.5", label: "Kimi K2.5" },
  { slug: "qwen3.7-max", label: "Qwen3.7 Max" },
  { slug: "qwen3.7-plus", label: "Qwen3.7 Plus" },
  { slug: "qwen3.6-plus", label: "Qwen3.6 Plus" },
  { slug: "qwen3.5-plus", label: "Qwen3.5 Plus" },
  { slug: "minimax-m3", label: "MiniMax M3" },
  { slug: "minimax-m2.7", label: "MiniMax M2.7" },
  { slug: "minimax-m2.5", label: "MiniMax M2.5" },
  { slug: "mimo-v2-pro", label: "MiMo V2 Pro" },
  { slug: "mimo-v2-omni", label: "MiMo V2 Omni" },
  { slug: "mimo-v2.5-pro", label: "MiMo V2.5 Pro" },
  { slug: "mimo-v2.5", label: "MiMo V2.5" },
  { slug: "hy3-preview", label: "HY3 Preview" },
] as const;

export const FALLBACK_OPENROUTER_MODELS = [
  { slug: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { slug: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { slug: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { slug: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { slug: "openai/gpt-5", label: "GPT-5" },
  { slug: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
] as const;

export const MODEL_CATALOG = [
  ...OPENCODE_GO_MODELS.map((model) => ({
    id: `opencode-go/${model.slug}`,
    provider: "opencode-go" as const,
    providerModelId: model.slug,
    label: model.label,
  })),
  ...FALLBACK_OPENROUTER_MODELS.map((model) => ({
    id: `openrouter/${model.slug}`,
    provider: "openrouter" as const,
    providerModelId: model.slug,
    label: model.label,
  })),
] as const;

export type ModelCatalogEntry = (typeof MODEL_CATALOG)[number];
export type ModelId = string;

function normalizeModelId(modelId: string): ModelId | null {
  const catalogEntry = MODEL_CATALOG.find((model) => model.id === modelId);
  if (catalogEntry) {
    return catalogEntry.id;
  }

  const opencodeId = `opencode-go/${modelId}`;
  if (MODEL_CATALOG.some((model) => model.id === opencodeId)) {
    return opencodeId;
  }

  if (modelId.startsWith("opencode-go/")) {
    const providerModelId = modelId.slice("opencode-go/".length);
    if (isOpenCodeGoModelSlug(providerModelId)) {
      return modelId;
    }
  }

  if (modelId.startsWith("openrouter/")) {
    const providerModelId = modelId.slice("openrouter/".length);
    if (isOpenRouterModelSlug(providerModelId)) {
      return modelId;
    }
  }

  if (
    modelId.includes("/") &&
    !modelId.startsWith("opencode-go/") &&
    !modelId.startsWith("openrouter/")
  ) {
    const openrouterId = `openrouter/${modelId}`;
    if (isOpenRouterModelSlug(modelId)) {
      return openrouterId;
    }
  }

  return null;
}

export function isSupportedModelId(modelId: string): modelId is ModelId {
  return normalizeModelId(modelId) !== null;
}

export function resolveModelId(modelId: string): ModelId {
  return normalizeModelId(modelId) ?? DEFAULT_MODEL_ID;
}

export function getProviderId(modelId: string): ProviderId {
  const resolved = resolveModelId(modelId);
  const entry = MODEL_CATALOG.find((model) => model.id === resolved);
  if (entry) return entry.provider;
  if (resolved.startsWith("opencode-go/")) return "opencode-go";
  if (resolved.startsWith("openrouter/")) return "openrouter";
  return DEFAULT_PROVIDER_ID;
}

export function getProviderModelId(modelId: string): string {
  const resolved = resolveModelId(modelId);
  const entry = MODEL_CATALOG.find((model) => model.id === resolved);
  if (entry) return entry.providerModelId;
  if (resolved.startsWith("opencode-go/")) {
    return resolved.slice("opencode-go/".length);
  }
  if (resolved.startsWith("openrouter/")) {
    return resolved.slice("openrouter/".length);
  }
  return resolved;
}

export function getModelsForProvider(provider: ProviderId): ModelCatalogEntry[] {
  return MODEL_CATALOG.filter((model) => model.provider === provider);
}

export function getModelLabel(modelId: string): string {
  const resolved = resolveModelId(modelId);
  const catalogLabel = MODEL_CATALOG.find((model) => model.id === resolved)?.label;
  if (catalogLabel) return catalogLabel;
  if (resolved.startsWith("opencode-go/")) {
    return labelFromSlug(resolved.slice("opencode-go/".length));
  }
  return resolved;
}

export function getDefaultModelForProvider(provider: ProviderId): ModelId {
  const models = getModelsForProvider(provider);
  return models[0]?.id ?? DEFAULT_MODEL_ID;
}

export function isStaticOpenCodeGoModelId(modelId: string): boolean {
  const resolved = normalizeModelId(modelId);
  return (
    resolved !== null &&
    MODEL_CATALOG.some(
      (model) => model.id === resolved && model.provider === "opencode-go",
    )
  );
}

function isOpenRouterModelSlug(value: string): boolean {
  return (
    value.length > 0 &&
    value.includes("/") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("..") &&
    !/\s/.test(value)
  );
}

export function isOpenCodeGoModelSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]*$/.test(value) && !value.includes("..");
}

function labelFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "glm") return "GLM";
      if (lower === "hy3") return "HY3";
      if (lower === "mimo") return "MiMo";
      if (lower === "minimax") return "MiniMax";
      if (lower === "qwen3.7") return "Qwen3.7";
      if (lower === "qwen3.6") return "Qwen3.6";
      if (lower === "qwen3.5") return "Qwen3.5";
      if (lower === "k2.7") return "K2.7";
      if (lower === "k2.6") return "K2.6";
      if (lower === "k2.5") return "K2.5";
      if (lower === "v2.5") return "V2.5";
      if (lower === "v2") return "V2";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
