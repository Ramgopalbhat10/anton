import type {
  OpenCodeGoCatalogSummary,
  OpenCodeGoModelSummary,
} from "@/src/lib/api-types";
import {
  getOpenCodeGoModelLabel,
  getProviderModelId,
  isOpenCodeGoModelId,
  isOpenCodeGoModelSlug,
  OPENCODE_GO_MODELS,
} from "@/src/lib/models";

const OPENCODE_GO_MODELS_URL = "https://opencode.ai/zen/go/v1/models";
const CATALOG_TTL_MS = 10 * 60 * 1000;

let catalogCache:
  | {
      expiresAt: number;
      value: OpenCodeGoCatalogSummary;
    }
  | undefined;

export async function getOpenCodeGoCatalog(
  { refresh = false }: { refresh?: boolean } = {},
): Promise<OpenCodeGoCatalogSummary> {
  const now = Date.now();
  if (!refresh && catalogCache && catalogCache.expiresAt > now) {
    return catalogCache.value;
  }

  try {
    const payload = await fetchOpenCodeGoJson();
    const value: OpenCodeGoCatalogSummary = {
      models: parseModels(payload),
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

export async function isSupportedOpenCodeGoModelId(
  modelId: string,
): Promise<boolean> {
  if (!isOpenCodeGoModelId(modelId)) return false;

  const providerModelId = getProviderModelId(modelId);
  if (OPENCODE_GO_MODELS.some((model) => model.slug === providerModelId)) {
    return true;
  }

  const catalog = await getOpenCodeGoCatalog();
  return catalog.models.some((model) => model.id === providerModelId);
}

function fallbackCatalog(
  error: string | null,
  fetchedAt: number,
): OpenCodeGoCatalogSummary {
  return {
    models: OPENCODE_GO_MODELS.map((model) => ({
      id: model.slug,
      name: model.label,
    })),
    source: "fallback",
    fetchedAt,
    error,
  };
}

async function fetchOpenCodeGoJson(): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (process.env.OPENCODE_GO_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OPENCODE_GO_API_KEY}`;
  }
  const response = await fetch(OPENCODE_GO_MODELS_URL, {
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`OpenCode Go request failed with HTTP ${response.status}`);
  }
  return response.json();
}

function parseModels(payload: unknown): OpenCodeGoModelSummary[] {
  const seen = new Set<string>();
  const data = dataArray(payload);
  return data.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.id);
    if (!id || !isOpenCodeGoModelSlug(id) || seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        name: stringValue(item.name) ?? getOpenCodeGoModelLabel(id),
      },
    ];
  });
}

function dataArray(payload: unknown): unknown[] {
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  return Array.isArray(payload) ? payload : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
