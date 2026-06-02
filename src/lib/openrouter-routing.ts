import { createHash } from "node:crypto";

import { getWorkspaceSettings } from "@/src/db/queries";
import type {
  OpenRouterRoutingPreference,
  OpenRouterRoutingPreferences,
} from "@/src/lib/api-types";
import {
  getProviderId,
  getProviderModelId,
} from "@/src/lib/models";
import { stripOpenRouterRoutingSuffix } from "@/src/lib/providers";

export type OpenRouterRoutingSource = "settings" | "env" | "builtin" | "default";

export type OpenRouterRoutingResolution = {
  source: OpenRouterRoutingSource;
  modelId: string;
  order: string[];
  allowFallbacks: boolean;
  requireParameters: true;
  fingerprint: string;
};

export function resolveOpenRouterRouting(
  modelId: string,
  preferences: OpenRouterRoutingPreferences | null | undefined =
    getWorkspaceSettings().openRouterRoutingPreferences,
): OpenRouterRoutingResolution | undefined {
  if (getProviderId(modelId) !== "openrouter") return undefined;

  const providerModelId = stripOpenRouterRoutingSuffix(
    getProviderModelId(modelId),
  );
  const settingsPreference =
    preferences?.[providerModelId] ?? preferences?.[`openrouter/${providerModelId}`];
  if (settingsPreference) {
    return routingResolution("settings", providerModelId, settingsPreference);
  }

  const envOrder = providerOrderFromEnv();
  const envAllowFallbacks = envBoolean("OPENROUTER_ALLOW_FALLBACKS");
  if (envOrder.length > 0 || envAllowFallbacks !== undefined) {
    return routingResolution("env", providerModelId, {
      order: envOrder,
      allowFallbacks: envAllowFallbacks ?? true,
    });
  }

  if (providerModelId === "deepseek/deepseek-v4-pro") {
    return routingResolution("builtin", providerModelId, {
      order: ["alibaba"],
      allowFallbacks: true,
    });
  }

  return routingResolution("default", providerModelId, {
    order: [],
    allowFallbacks: true,
  });
}

export function openRouterProviderOptions(
  routing: OpenRouterRoutingResolution | undefined,
): {
  provider?: {
    order?: string[];
    allow_fallbacks: boolean;
    require_parameters: true;
  };
} {
  if (!routing) return {};
  return {
    provider: {
      ...(routing.order.length > 0 ? { order: routing.order } : {}),
      allow_fallbacks: routing.allowFallbacks,
      require_parameters: true,
    },
  };
}

export function sanitizeOpenRouterRoutingPreferences(
  value: OpenRouterRoutingPreferences | null | undefined,
): OpenRouterRoutingPreferences {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([modelId, preference]) => {
      const normalizedModelId = modelId.trim();
      const sanitized = sanitizeOpenRouterRoutingPreference(preference);
      return normalizedModelId && sanitized ? [[normalizedModelId, sanitized]] : [];
    }),
  );
}

function sanitizeOpenRouterRoutingPreference(
  preference: OpenRouterRoutingPreference,
): OpenRouterRoutingPreference | undefined {
  const order = Array.from(
    new Set(
      preference.order
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .slice(0, 24),
    ),
  );
  return {
    order,
    allowFallbacks: preference.allowFallbacks,
  };
}

function routingResolution(
  source: OpenRouterRoutingSource,
  modelId: string,
  preference: OpenRouterRoutingPreference,
): OpenRouterRoutingResolution {
  const order = Array.from(new Set(preference.order));
  const fingerprintInput = {
    modelId,
    source,
    order,
    allowFallbacks: preference.allowFallbacks,
    requireParameters: true,
  };
  return {
    source,
    modelId,
    order,
    allowFallbacks: preference.allowFallbacks,
    requireParameters: true,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(fingerprintInput))
      .digest("hex")
      .slice(0, 16),
  };
}

function providerOrderFromEnv(): string[] {
  return (process.env.OPENROUTER_PROVIDER_ORDER ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function envBoolean(name: string): boolean | undefined {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}
