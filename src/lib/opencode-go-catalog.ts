import type {
  OpenCodeGoCatalogSummary,
  OpenCodeGoModelSummary,
} from "@/src/lib/api-types";
import {
  OPENCODE_GO_MODELS,
  isOpenCodeGoModelSlug,
  isStaticOpenCodeGoModelId,
} from "@/src/lib/models";

const OPENCODE_GO_API_BASE = "https://opencode.ai/zen/go";
const CATALOG_TTL_MS = 10 * 60 * 1000;

let catalogCache:
  | {
      expiresAt: number;
      value: OpenCodeGoCatalogSummary;
    }
  | undefined;

export async function getOpenCodeGoCatalog(): Promise<OpenCodeGoCatalogSummary> {
  const now = Date.now();
  if (catalogCache && catalogCache.expiresAt > now) return catalogCache.value;

  try {
    const models = await fetchOpenCodeGoJson("/v1/models");
    const parsedModels = parseModels(models);
    if (parsedModels.length === 0) {
      throw new Error("OpenCode Go catalog response contained no models");
    }
    const value: OpenCodeGoCatalogSummary = {
      models: parsedModels,
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
  if (isStaticOpenCodeGoModelId(modelId)) return true;
  const providerModelId = openCodeGoProviderModelId(modelId);
  if (!providerModelId) return false;
  const catalog = await getOpenCodeGoCatalog();
  return catalog.models.some((model) => model.id === providerModelId);
}

function openCodeGoProviderModelId(modelId: string): string | null {
  const trimmed = modelId.trim();
  if (trimmed.startsWith("opencode-go/")) {
    const providerModelId = trimmed.slice("opencode-go/".length);
    return isOpenCodeGoModelSlug(providerModelId) ? providerModelId : null;
  }
  return null;
}

function fallbackCatalog(
  error: string | null,
  fetchedAt: number,
): OpenCodeGoCatalogSummary {
  return {
    models: OPENCODE_GO_MODELS.map((model) => ({
      id: model.slug,
      name: model.label,
      created: null,
      ownedBy: null,
      contextLength: null,
      promptPrice: null,
      completionPrice: null,
    })),
    source: "fallback",
    fetchedAt,
    error,
  };
}

async function fetchOpenCodeGoJson(path: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (process.env.OPENCODE_GO_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OPENCODE_GO_API_KEY}`;
  }
  const response = await fetch(`${OPENCODE_GO_API_BASE}${path}`, {
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`OpenCode Go request failed with HTTP ${response.status}`);
  }
  return response.json();
}

function parseModels(payload: unknown): OpenCodeGoModelSummary[] {
  return dataArray(payload).flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.id);
    if (!id || !isOpenCodeGoModelSlug(id)) return [];
    return [
      {
        id,
        name: labelFromModelId(id),
        created: numberValue(item.created) ?? null,
        ownedBy: stringValue(item.owned_by) ?? null,
        contextLength: null,
        promptPrice: null,
        completionPrice: null,
      },
    ];
  });
}

function labelFromModelId(modelId: string): string {
  return (
    OPENCODE_GO_MODELS.find((model) => model.slug === modelId)?.label ??
    modelId
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function dataArray(payload: unknown): unknown[] {
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  return Array.isArray(payload) ? payload : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
