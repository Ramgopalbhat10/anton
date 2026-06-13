"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  Cpu,
  Loader2,
  Plus,
  Route,
  Settings2,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  X,
} from "lucide-react";

import { ErrorBanner, LoadingState } from "@/components/shared/feedback-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { PermissionMode } from "@/src/agent/permissions";
import type { WorkspaceSettingsSummary } from "@/src/lib/api-types";
import {
  DEFAULT_MODEL_ID,
  getProviderId,
  getProviderModelId,
  isSupportedModelId,
  resolveModelId,
  type ModelId,
} from "@/src/lib/models";
import type {
  OpenRouterModelEndpointsSummary,
  OpenRouterRoutingPreferences,
  OpenRouterRoutingPreference,
} from "@/src/lib/api-types";
import {
  errorMessage,
  getJson,
  jsonHeaders,
  requestJson,
} from "@/src/lib/client-fetch";
import { cn } from "@/lib/utils";
import { notifyWorkspaceAgentDefaultsChanged } from "@/src/lib/client-state/workspace-agent-defaults";

import { ModelPicker } from "@/components/features/chat/model-picker";
import { SettingsPageShell } from "./settings-shell";

const ROW_SELECT_TRIGGER_CLASS =
  "h-[34px] rounded-lg bg-input px-3 text-[13px] text-foreground";
const DEFAULT_ROUTING: OpenRouterRoutingPreference = {
  order: [],
  allowFallbacks: true,
};

const PERMISSION_MODE_ITEMS = [
  { value: "default", label: "Ask every time", Icon: ShieldQuestion },
  { value: "auto-review", label: "Auto-review", Icon: ShieldCheck },
  { value: "full-access", label: "Full access", Icon: ShieldOff },
] as const satisfies readonly {
  value: PermissionMode;
  label: string;
  Icon: typeof ShieldCheck;
}[];

export function AgentSettingsPanel() {
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL_ID);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("auto-review");
  const [routingPreferences, setRoutingPreferences] =
    useState<OpenRouterRoutingPreferences>({});
  const [endpointData, setEndpointData] =
    useState<OpenRouterModelEndpointsSummary | null>(null);
  const [endpointLoading, setEndpointLoading] = useState(false);
  const [customProviderTag, setCustomProviderTag] = useState("");
  const [forceCustomRouting, setForceCustomRouting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const data = await getJson<{ settings: WorkspaceSettingsSummary }>(
          "/api/workspace-settings",
        );
        if (cancelled) return;
        setModel(
          data.settings.defaultModel &&
            isSupportedModelId(data.settings.defaultModel)
            ? resolveModelId(data.settings.defaultModel)
            : DEFAULT_MODEL_ID,
        );
        setPermissionMode(data.settings.defaultPermissionMode ?? "auto-review");
        setRoutingPreferences(data.settings.openRouterRoutingPreferences);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err, "Failed to load agent defaults"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const openRouterModelId =
    getProviderId(model) === "openrouter" ? getProviderModelId(model) : null;
  const routingForSelectedModel = openRouterModelId
    ? routingPreferences[openRouterModelId] ?? DEFAULT_ROUTING
    : DEFAULT_ROUTING;
  const hasCustomRouting =
    routingForSelectedModel.order.length > 0 ||
    !routingForSelectedModel.allowFallbacks;
  const routingMode: "auto" | "custom" =
    hasCustomRouting || forceCustomRouting ? "custom" : "auto";

  const selectedEndpointTags = useMemo(
    () => new Set(routingForSelectedModel.order),
    [routingForSelectedModel.order],
  );

  useEffect(() => {
    if (!openRouterModelId) return;
    let cancelled = false;
    // Endpoint fetch is external state hydration for the selected model.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEndpointLoading(true);
    getJson<{ endpoints: OpenRouterModelEndpointsSummary }>(
      `/api/openrouter/model-endpoints?model=${encodeURIComponent(openRouterModelId)}`,
    )
      .then((data) => {
        if (!cancelled) setEndpointData(data.endpoints);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEndpointData({
            model: openRouterModelId,
            endpoints: [],
            source: "fallback",
            fetchedAt: Date.now(),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setEndpointLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openRouterModelId]);

  const updateSelectedRouting = (
    updater: (current: OpenRouterRoutingPreference) => OpenRouterRoutingPreference,
  ) => {
    if (!openRouterModelId) return;
    setRoutingPreferences((current) => ({
      ...current,
      [openRouterModelId]: updater(current[openRouterModelId] ?? DEFAULT_ROUTING),
    }));
  };

  const addProviderTag = (tag: string) => {
    const normalized = tag.trim();
    if (!normalized) return;
    updateSelectedRouting((current) => ({
      ...current,
      order: current.order.includes(normalized)
        ? current.order
        : [...current.order, normalized],
    }));
    setCustomProviderTag("");
  };

  const removeProviderTag = (tag: string) => {
    updateSelectedRouting((current) => ({
      ...current,
      order: current.order.filter((item) => item !== tag),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = await requestJson<{ settings: WorkspaceSettingsSummary }>(
        "/api/workspace-settings",
        {
          method: "PATCH",
          headers: jsonHeaders(),
          body: JSON.stringify({
            defaultModel: model,
            defaultPermissionMode: permissionMode,
            openRouterRoutingPreferences: routingPreferences,
          }),
        },
      );
      setRoutingPreferences(data.settings.openRouterRoutingPreferences);
      notifyWorkspaceAgentDefaultsChanged(data.settings);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to save agent defaults"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPageShell
      title="Agent defaults"
      description="Set the default model, provider routing, and approval strictness for new chat sessions."
      contentClassName="space-y-7"
    >
      {error ? <ErrorBanner message={error} /> : null}
      {loading ? (
        <LoadingState label="Loading agent defaults..." />
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-border bg-card">
          <SettingRow
            title="Default model"
            description="Used when a session has no saved composer override."
          >
            <ModelPicker
              value={model}
              onChange={(next) => {
                setModel(next);
                setForceCustomRouting(false);
              }}
              showThinking={false}
              triggerIcon={<Cpu className="size-3.5 text-muted-foreground/80" />}
              triggerClassName="h-[34px] max-w-64 rounded-lg border-border bg-input px-3 text-[13px] font-normal text-foreground hover:bg-input/80"
            />
          </SettingRow>

          <SettingRow
            title="Provider routing"
            description="How requests are routed across configured providers."
            divider
          >
            <Select
              value={routingMode}
              onValueChange={(value) => {
                if (value === "auto") {
                  updateSelectedRouting(() => DEFAULT_ROUTING);
                  setForceCustomRouting(false);
                } else {
                  setForceCustomRouting(true);
                }
              }}
              disabled={!openRouterModelId}
            >
              <SelectTrigger
                className={ROW_SELECT_TRIGGER_CLASS}
                aria-label="Provider routing mode"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectViewport>
                  <SelectItem value="auto">
                    <span className="inline-flex items-center gap-1.5 leading-4">
                      <Route className="size-3.5 text-muted-foreground/80" />
                      Auto
                    </span>
                  </SelectItem>
                  <SelectItem value="custom">
                    <span className="inline-flex items-center gap-1.5 leading-4">
                      <Settings2 className="size-3.5 text-muted-foreground/80" />
                      Custom
                    </span>
                  </SelectItem>
                </SelectViewport>
              </SelectContent>
            </Select>
          </SettingRow>

          {openRouterModelId && routingMode === "custom" ? (
            <div className="space-y-3 px-5 pb-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {routingForSelectedModel.order.length > 0 ? (
                  routingForSelectedModel.order.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => removeProviderTag(tag)}
                      className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 text-[11px] font-medium text-foreground"
                      aria-label={`Remove ${tag} from provider order`}
                    >
                      <span className="truncate">{tag}</span>
                      <X className="size-3 shrink-0" />
                    </button>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No pinned provider order.
                  </span>
                )}
              </div>

              <div className="flex max-w-sm items-center gap-1.5">
                <Input
                  value={customProviderTag}
                  onChange={(event) => setCustomProviderTag(event.target.value)}
                  placeholder="provider/tag"
                  className="h-7 px-2 text-[11px]"
                  aria-label="Custom OpenRouter provider tag"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addProviderTag(customProviderTag);
                    }
                  }}
                />
                <Button
                  type="button"
                  size="icon-xs"
                  variant="secondary"
                  onClick={() => addProviderTag(customProviderTag)}
                  disabled={!customProviderTag.trim()}
                  aria-label="Add provider tag"
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-2.5 py-2">
                <span className="text-xs font-medium">Allow fallbacks</span>
                <Switch
                  checked={routingForSelectedModel.allowFallbacks}
                  onCheckedChange={(checked) =>
                    updateSelectedRouting((current) => ({
                      ...current,
                      allowFallbacks: checked,
                    }))
                  }
                  className="h-4 w-7 ring-0 data-[state=checked]:ring-0"
                  thumbClassName="size-3 data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0.5"
                  aria-label="Allow OpenRouter fallbacks"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Endpoint recommendations
                  </span>
                  {endpointLoading ? (
                    <span className="text-[11px] text-muted-foreground">
                      Loading...
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(endpointData?.endpoints ?? []).slice(0, 10).map((endpoint) => {
                    const selected = selectedEndpointTags.has(endpoint.tag);
                    return (
                      <button
                        key={endpoint.tag}
                        type="button"
                        onClick={() => addProviderTag(endpoint.tag)}
                        disabled={selected}
                        className="max-w-full rounded-md border border-border px-2 py-1 text-left text-[11px] leading-4 hover:bg-accent disabled:cursor-default disabled:border-primary/40 disabled:bg-primary/10"
                        title={endpointSummary(endpoint)}
                      >
                        <span className="block truncate font-medium text-foreground">
                          {endpoint.providerName} / {endpoint.tag}
                        </span>
                        <span className="block truncate text-muted-foreground">
                          {endpointMeta(endpoint)}
                        </span>
                      </button>
                    );
                  })}
                  {!endpointLoading && (endpointData?.endpoints.length ?? 0) === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      No endpoint details available.
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <SettingRow
            title="Approval strictness"
            description="Default permission mode for new sessions. Composer controls still override per session."
            divider
          >
            <Select
              value={permissionMode}
              onValueChange={(value) => setPermissionMode(value as PermissionMode)}
            >
              <SelectTrigger
                className={ROW_SELECT_TRIGGER_CLASS}
                aria-label="Approval strictness"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectViewport>
                  {PERMISSION_MODE_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      <span className="inline-flex items-center gap-1.5 leading-4">
                        <item.Icon className="size-3.5 text-muted-foreground/80" />
                        {item.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectViewport>
              </SelectContent>
            </Select>
          </SettingRow>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-layout-border px-5 py-3">
            <p className="text-[12.5px] text-muted-foreground/80">
              Defaults apply to new sessions. Workspace root remains in
              Workspaces settings.
            </p>
            <Button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="h-[33px] rounded-lg px-4 text-[13px] font-semibold"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Save defaults
            </Button>
          </div>
        </div>
      )}
    </SettingsPageShell>
  );
}

function SettingRow({
  title,
  description,
  divider,
  children,
}: {
  title: string;
  description: string;
  divider?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4",
        divider && "border-t border-layout-border",
      )}
    >
      <div className="min-w-0 flex-1 basis-60 space-y-1">
        <h3 className="text-[13.5px] font-semibold">{title}</h3>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function endpointMeta(
  endpoint: OpenRouterModelEndpointsSummary["endpoints"][number],
): string {
  const cache = endpoint.supportsImplicitCaching
    ? "cache"
    : endpoint.cacheReadPrice
      ? "cache price"
      : "no cache";
  const status = endpoint.status === 0 ? "healthy" : `status ${endpoint.status ?? "?"}`;
  const uptime =
    endpoint.uptimeLast30m === null
      ? "uptime ?"
      : `${endpoint.uptimeLast30m.toFixed(0)}% up`;
  const latency =
    endpoint.latencyLast30m === null
      ? "lat ?"
      : `${Math.round(endpoint.latencyLast30m)}ms`;
  return `${cache} / ${status} / ${uptime} / ${latency} / ${formatPrice(endpoint.promptPrice)}/${formatPrice(endpoint.cacheReadPrice)}`;
}

function endpointSummary(
  endpoint: OpenRouterModelEndpointsSummary["endpoints"][number],
): string {
  return [
    endpoint.providerName,
    endpoint.tag,
    endpointMeta(endpoint),
    `prompt ${formatPrice(endpoint.promptPrice)}`,
    `cache read ${formatPrice(endpoint.cacheReadPrice)}`,
    `cache write ${formatPrice(endpoint.cacheWritePrice)}`,
  ].join(" | ");
}

function formatPrice(value: string | null): string {
  if (!value) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  if (numeric === 0) return "$0";
  return `$${numeric.toExponential(1)}`;
}
