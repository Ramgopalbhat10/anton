import type {
  OpenRouterCatalogSummary,
  OpenRouterModelEndpointSummary,
  OpenRouterModelEndpointsSummary,
  OpenRouterModelSummary,
  OpenRouterProviderSummary,
} from "@/src/lib/api-types";
import {
  FALLBACK_OPENROUTER_MODELS,
  getProviderId,
} from "@/src/lib/models";
import { isSupportedOpenCodeGoModelId } from "@/src/lib/opencode-go-catalog";

const OPENROUTER_API_BASE = "https://openrouter.ai";
const CATALOG_TTL_MS = 10 * 60 * 1000;

let catalogCache:
  | {
      expiresAt: number;
      value: OpenRouterCatalogSummary;
    }
  | undefined;

const endpointCache = new Map<
  string,
  {
    expiresAt: number;
    value: OpenRouterModelEndpointsSummary;
  }
>();

export async function getOpenRouterCatalog(
  { refresh = false }: { refresh?: boolean } = {},
): Promise<OpenRouterCatalogSummary> {
  const now = Date.now();
  if (!refresh && catalogCache && catalogCache.expiresAt > now) {
    return catalogCache.value;
  }

  try {
    const [providers, models] = await Promise.all([
      fetchOpenRouterJson("/api/v1/providers"),
      fetchOpenRouterJson(
        "/api/v1/models?supported_parameters=tools&output_modalities=text",
      ),
    ]);
    const value: OpenRouterCatalogSummary = {
      providers: parseProviders(providers),
      models: parseModels(models),
      source: "api",
      fetchedAt: now,
      error: null,
    };
    catalogCache = { expiresAt: now + CATALOG_TTL_MS, value };
    return value;
  } catch (err) {
    const value = fallbackCatalog(errorMessage(err), now);
    catalogCache = { expiresAt: now + CATALOG_TTL_MS, value };
    return value;
  }
}

export async function getOpenRouterModelEndpoints(
  modelId: string,
): Promise<OpenRouterModelEndpointsSummary> {
  const normalizedModelId = modelId.trim();
  const now = Date.now();
  const cached = endpointCache.get(normalizedModelId);
  if (cached && cached.expiresAt > now) return cached.value;

  try {
    const catalog = await getOpenRouterCatalog();
    const model = catalog.models.find((entry) => entry.id === normalizedModelId);
    const detailsPath =
      model?.detailsPath ?? `/api/v1/models/${normalizedModelId}/endpoints`;
    const payload = await fetchOpenRouterJson(detailsPath);
    const value: OpenRouterModelEndpointsSummary = {
      model: normalizedModelId,
      endpoints: sortEndpointRecommendations(parseEndpoints(payload)),
      source: "api",
      fetchedAt: now,
      error: null,
    };
    endpointCache.set(normalizedModelId, {
      expiresAt: now + CATALOG_TTL_MS,
      value,
    });
    return value;
  } catch (err) {
    const value: OpenRouterModelEndpointsSummary = {
      model: normalizedModelId,
      endpoints: [],
      source: "fallback",
      fetchedAt: now,
      error: errorMessage(err),
    };
    endpointCache.set(normalizedModelId, {
      expiresAt: now + CATALOG_TTL_MS,
      value,
    });
    return value;
  }
}

export async function isSupportedAgentModelId(modelId: string): Promise<boolean> {
  if (getProviderId(modelId) === "opencode-go") {
    return isSupportedOpenCodeGoModelId(modelId);
  }
  const providerModelId = modelId.startsWith("openrouter/")
    ? modelId.slice("openrouter/".length)
    : modelId.includes("/")
      ? modelId
      : "";
  if (!providerModelId) return false;
  const catalog = await getOpenRouterCatalog();
  return catalog.models.some((model) => model.id === providerModelId);
}

function fallbackCatalog(
  error: string | null,
  fetchedAt: number,
): OpenRouterCatalogSummary {
  return {
    providers: [],
    models: FALLBACK_OPENROUTER_MODELS.map((model) => ({
      id: model.slug,
      name: model.label,
      contextLength: null,
      promptPrice: null,
      completionPrice: null,
      detailsPath: `/api/v1/models/${model.slug}/endpoints`,
    })),
    source: "fallback",
    fetchedAt,
    error,
  };
}

async function fetchOpenRouterJson(pathOrUrl: string): Promise<unknown> {
  const url = pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `${OPENROUTER_API_BASE}${pathOrUrl}`;
  const headers: Record<string, string> = {};
  if (process.env.OPENROUTER_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
  }
  const response = await fetch(url, {
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`OpenRouter request failed with HTTP ${response.status}`);
  }
  return response.json();
}

function parseProviders(payload: unknown): OpenRouterProviderSummary[] {
  const data = dataArray(payload);
  return data.flatMap((item) => {
    if (!isRecord(item)) return [];
    const slug = stringValue(item.slug);
    const name = stringValue(item.name);
    if (!slug || !name) return [];
    return [
      {
        slug,
        name,
        headquarters: stringValue(item.headquarters) ?? null,
        datacenters: stringArray(item.datacenters),
        privacyPolicyUrl: stringValue(item.privacy_policy_url) ?? null,
        termsOfServiceUrl: stringValue(item.terms_of_service_url) ?? null,
        statusPageUrl: stringValue(item.status_page_url) ?? null,
      },
    ];
  });
}

function parseModels(payload: unknown): OpenRouterModelSummary[] {
  const data = dataArray(payload);
  return data.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.id);
    const name = stringValue(item.name);
    const supportedParameters = stringArray(item.supported_parameters);
    const architecture = isRecord(item.architecture) ? item.architecture : {};
    const outputModalities = stringArray(architecture.output_modalities);
    if (
      !id ||
      !name ||
      !supportedParameters.includes("tools") ||
      !outputModalities.includes("text")
    ) {
      return [];
    }
    const pricing = isRecord(item.pricing) ? item.pricing : {};
    const links = isRecord(item.links) ? item.links : {};
    return [
      {
        id,
        name,
        contextLength: numberValue(item.context_length) ?? null,
        promptPrice: stringValue(pricing.prompt) ?? null,
        completionPrice: stringValue(pricing.completion) ?? null,
        detailsPath: stringValue(links.details) ?? null,
      },
    ];
  });
}

function parseEndpoints(payload: unknown): OpenRouterModelEndpointSummary[] {
  const root = isRecord(payload) ? payload.data ?? payload : payload;
  const endpoints = isRecord(root) && Array.isArray(root.endpoints)
    ? root.endpoints
    : Array.isArray(root)
      ? root
      : [];
  return endpoints.flatMap((item) => {
    if (!isRecord(item)) return [];
    const tag = stringValue(item.tag);
    const providerName = stringValue(item.provider_name);
    const name = stringValue(item.name);
    if (!tag || !providerName || !name) return [];
    const pricing = isRecord(item.pricing) ? item.pricing : {};
    return [
      {
        tag,
        providerName,
        name,
        status: numberValue(item.status) ?? null,
        uptimeLast30m: numberValue(item.uptime_last_30m) ?? null,
        latencyLast30m: numberValue(item.latency_last_30m) ?? null,
        supportsImplicitCaching: item.supports_implicit_caching === true,
        promptPrice: stringValue(pricing.prompt) ?? null,
        completionPrice: stringValue(pricing.completion) ?? null,
        cacheReadPrice:
          stringValue(pricing.input_cache_read) ??
          stringValue(pricing.cache_read) ??
          null,
        cacheWritePrice:
          stringValue(pricing.input_cache_write) ??
          stringValue(pricing.cache_write) ??
          null,
      },
    ];
  });
}

function sortEndpointRecommendations(
  endpoints: OpenRouterModelEndpointSummary[],
): OpenRouterModelEndpointSummary[] {
  return [...endpoints].sort((left, right) => {
    const leftCache = cacheRank(left);
    const rightCache = cacheRank(right);
    if (leftCache !== rightCache) return rightCache - leftCache;
    const leftHealthy = healthRank(left);
    const rightHealthy = healthRank(right);
    if (leftHealthy !== rightHealthy) return rightHealthy - leftHealthy;
    const leftLatency = left.latencyLast30m ?? Number.POSITIVE_INFINITY;
    const rightLatency = right.latencyLast30m ?? Number.POSITIVE_INFINITY;
    return leftLatency - rightLatency;
  });
}

function cacheRank(endpoint: OpenRouterModelEndpointSummary): number {
  if (endpoint.supportsImplicitCaching) return 3;
  if (endpoint.cacheReadPrice !== null && endpoint.cacheWritePrice !== null) return 2;
  if (endpoint.cacheReadPrice !== null) return 1;
  return 0;
}

function healthRank(endpoint: OpenRouterModelEndpointSummary): number {
  const status = endpoint.status === 0 ? 1 : 0;
  return status + (endpoint.uptimeLast30m ?? 0) / 100;
}

function dataArray(payload: unknown): unknown[] {
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  return Array.isArray(payload) ? payload : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
