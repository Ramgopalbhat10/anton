"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Loader2, RefreshCw, Search } from "lucide-react";

import {
  getModelLabel,
  getModelsForProvider,
  getProviderId,
  getProviderModelId,
  PROVIDERS,
  type ModelId,
  type ProviderId,
} from "@/src/lib/models";
import type { OpenRouterCatalogSummary } from "@/src/lib/api-types";
import { getJson } from "@/src/lib/client-fetch";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PopupSectionHeader } from "@/components/shared/popup-section-header";
import {
  PopupSortSelect,
  type PopupSortOption,
} from "@/components/shared/popup-sort-select";
import { cn } from "@/lib/utils";

type PickerModel = {
  id: string;
  label: string;
  providerSlug?: string;
  contextLength?: number | null;
  promptPrice?: string | null;
  completionPrice?: string | null;
};

type ModelFilter =
  | "recommended"
  | "free"
  | "long-context"
  | "low-price"
  | "name-asc"
  | "context-desc"
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "qwen"
  | "meta"
  | "mistral"
  | "other";

const MODEL_FILTER_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "free", label: "Free" },
  { value: "long-context", label: "Long context" },
  { value: "low-price", label: "Low price" },
  { value: "name-asc", label: "Name A-Z" },
  { value: "context-desc", label: "Context high" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "google", label: "Google" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "qwen", label: "Qwen" },
  { value: "meta", label: "Meta" },
  { value: "mistral", label: "Mistral" },
  { value: "other", label: "Other families" },
] as const satisfies readonly PopupSortOption<ModelFilter>[];

const MODEL_FAMILY_FILTERS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "qwen",
  "meta",
  "mistral",
] as const satisfies readonly ModelFilter[];

interface ModelPickerProps {
  value: ModelId;
  onChange: (value: ModelId) => void;
  thinkingEnabled?: boolean;
  onThinkingEnabledChange?: (enabled: boolean) => void;
  showThinking?: boolean;
  disabled?: boolean;
  triggerClassName?: string;
  triggerIcon?: ReactNode;
}

export function ModelPicker({
  value,
  onChange,
  thinkingEnabled = false,
  onThinkingEnabledChange,
  showThinking = true,
  disabled,
  triggerClassName,
  triggerIcon,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState<ProviderId>(() =>
    getProviderId(value),
  );
  const [query, setQuery] = useState("");
  const [modelFilter, setModelFilter] = useState<ModelFilter>("recommended");
  const [catalog, setCatalog] = useState<OpenRouterCatalogSummary | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const loadCatalog = useCallback(async ({ refresh = false } = {}) => {
    if (!refresh && (catalog || catalogError)) return;
    setCatalogLoading(true);
    try {
      const data = await getJson<{ catalog: OpenRouterCatalogSummary }>(
        "/api/openrouter/catalog",
      );
      setCatalog(data.catalog);
      setCatalogError(null);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : String(err));
    } finally {
      setCatalogLoading(false);
    }
  }, [catalog, catalogError]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const nextProvider = getProviderId(value);
      setActiveProvider(nextProvider);
      if (nextProvider === "openrouter") void loadCatalog();
    }
    setOpen(nextOpen);
  };

  const openRouterModels = useMemo(() => {
    const apiModels: PickerModel[] =
      catalog?.models.map((model) => ({
        id: `openrouter/${model.id}`,
        label: model.name,
        providerSlug: model.id.split("/")[0],
        contextLength: model.contextLength,
        promptPrice: model.promptPrice,
        completionPrice: model.completionPrice,
      })) ??
      getModelsForProvider("openrouter").map((model) => ({
        id: model.id,
        label: model.label,
        providerSlug: model.providerModelId.split("/")[0],
        contextLength: null,
        promptPrice: null,
        completionPrice: null,
      }));
    const selectedProviderModelId =
      getProviderId(value) === "openrouter" ? getProviderModelId(value) : null;
    const withSelected =
      selectedProviderModelId &&
      !apiModels.some((model) => model.id === value)
        ? [
            {
              id: value,
              label: getModelLabel(value),
              providerSlug: selectedProviderModelId.split("/")[0],
            },
            ...apiModels,
          ]
        : apiModels;
    const needle = query.trim().toLowerCase();
    const filtered = withSelected.filter(
      (model) =>
        matchesQuery(model.label, model.id, needle) &&
        matchesModelFilter(model, modelFilter),
    );
    return sortModelResults(filtered, modelFilter).slice(0, 80);
  }, [catalog, modelFilter, query, value]);

  const triggerLabel =
    catalog?.models.find(
      (model) =>
        getProviderId(value) === "openrouter" &&
        model.id === getProviderModelId(value),
    )?.name ?? getModelLabel(value);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          className={cn("min-w-0 justify-between", triggerClassName)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {triggerIcon}
            <span className="truncate">{triggerLabel}</span>
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-[min(360px,calc(100vw-1rem))] overflow-hidden p-0"
      >
        <Tabs
          value={activeProvider}
          onValueChange={(next) => {
            setActiveProvider(next as ProviderId);
            if (next === "openrouter") void loadCatalog();
          }}
          className="min-w-0 gap-0"
        >
          <div className="p-2 pb-1">
            <TabsList size="md" className="flex w-full rounded-lg bg-input p-[3px]">
              {PROVIDERS.map((provider) => (
                <TabsTrigger
                  key={provider.id}
                  value={provider.id}
                  className="dark:data-[state=active]:border-border"
                >
                  {provider.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="px-3 pb-2.5 pt-1">
            <div className="flex items-center gap-2 rounded-[7px] bg-input px-2.5 py-[7px] ring-1 ring-border">
              <Search className="size-[13px] shrink-0 text-muted-foreground/70" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70"
                aria-label="Search models"
              />
              {activeProvider === "openrouter" ? (
                <button
                  type="button"
                  onClick={() => void loadCatalog({ refresh: true })}
                  disabled={catalogLoading}
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
                  aria-label="Refresh OpenRouter models"
                  title="Refresh OpenRouter models"
                >
                  {catalogLoading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                </button>
              ) : null}
            </div>
            {activeProvider === "openrouter" && catalogError ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Static fallback models shown.
              </p>
            ) : null}
          </div>
          {PROVIDERS.map((provider) => {
            const visibleModels: PickerModel[] =
              provider.id === "openrouter"
                ? openRouterModels
                : getModelsForProvider(provider.id).filter((model) =>
                    matchesQuery(model.label, model.id, query),
                  ).map((model) => ({
                    id: model.id,
                    label: model.label,
                  }));
            return (
              <TabsContent key={provider.id} value={provider.id} className="m-0">
                <div className="max-h-96 overflow-y-auto p-1.5 pt-0">
                  <PopupSectionHeader
                    title="Models"
                    action={
                      provider.id === "openrouter" ? (
                        <PopupSortSelect
                          value={modelFilter}
                          options={MODEL_FILTER_OPTIONS}
                          onChange={setModelFilter}
                          aria-label="Filter models"
                          className="size-[22px] rounded-md bg-secondary text-foreground ring-1 ring-border hover:bg-secondary/80"
                        />
                      ) : undefined
                    }
                  />
                  {visibleModels.length === 0 ? (
                    <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                      {provider.id === "openrouter" && catalogLoading
                        ? "Loading models..."
                        : "No models found."}
                    </div>
                  ) : (
                    <ul className="grid gap-0.5">
                      {visibleModels.map((model) => {
                        const selected = model.id === value;
                        return (
                          <li key={model.id}>
                            <button
                              type="button"
                              className={cn(
                                "grid w-full grid-cols-[minmax(0,1fr)_0.875rem] items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent",
                                selected && "bg-accent text-foreground",
                              )}
                              onClick={() => {
                                onChange(model.id as ModelId);
                                setOpen(false);
                              }}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-[12.5px] font-medium leading-4">
                                  {model.label}
                                </span>
                                <span className="block truncate font-mono text-[10.5px] text-muted-foreground/80">
                                  {provider.id === "openrouter"
                                    ? openRouterModelMeta(model)
                                    : getProviderModelId(model.id as ModelId)}
                                </span>
                              </span>
                              {selected ? (
                                <Check className="size-3.5 text-primary" />
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
        {showThinking && onThinkingEnabledChange ? (
          <div
            className="flex items-center justify-between gap-4 border-t border-layout-border px-3 py-2.5 text-[12.5px]"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <span className="font-medium text-foreground">Thinking</span>
            <Switch
              checked={thinkingEnabled}
              onCheckedChange={onThinkingEnabledChange}
              className="h-4 w-7 ring-0 data-[state=checked]:ring-0"
              thumbClassName="size-3 data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0.5"
              aria-label="Toggle model thinking"
            />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function isFreeModel(model: PickerModel): boolean {
  return priceValue(model.promptPrice) === 0 && priceValue(model.completionPrice) === 0;
}

function matchesQuery(label: string, id: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    label.toLowerCase().includes(needle) ||
    id.toLowerCase().includes(needle)
  );
}

function matchesModelFilter(model: PickerModel, filter: ModelFilter): boolean {
  switch (filter) {
    case "recommended":
    case "name-asc":
    case "context-desc":
      return true;
    case "free":
      return isFreeModel(model);
    case "long-context":
      return (model.contextLength ?? 0) >= 128000;
    case "low-price":
      return isLowPriceModel(model);
    case "other":
      return !MODEL_FAMILY_FILTERS.some((family) =>
        modelFamilyMatches(model, family),
      );
    default:
      return modelFamilyMatches(model, filter);
  }
}

function sortModelResults(
  models: PickerModel[],
  filter: ModelFilter,
): PickerModel[] {
  const sorted = [...models];
  switch (filter) {
    case "name-asc":
      sorted.sort((a, b) => a.label.localeCompare(b.label));
      break;
    case "context-desc":
    case "long-context":
      sorted.sort(
        (a, b) =>
          (b.contextLength ?? 0) - (a.contextLength ?? 0) ||
          a.label.localeCompare(b.label),
      );
      break;
    case "free":
      sorted.sort(
        (a, b) =>
          (b.contextLength ?? 0) - (a.contextLength ?? 0) ||
          a.label.localeCompare(b.label),
      );
      break;
    case "low-price":
      sorted.sort(
        (a, b) =>
          modelPriceScore(a) - modelPriceScore(b) ||
          (b.contextLength ?? 0) - (a.contextLength ?? 0) ||
          a.label.localeCompare(b.label),
      );
      break;
    default:
      break;
  }
  return sorted;
}

function modelFamilyMatches(model: PickerModel, family: ModelFilter): boolean {
  const slug = (model.providerSlug ?? providerSlugFromModelId(model.id)).toLowerCase();
  const id = model.id.toLowerCase();
  switch (family) {
    case "openai":
      return slug === "openai" || id.includes("/gpt-");
    case "google":
      return slug.startsWith("google") || id.includes("/gemini");
    case "meta":
      return slug === "meta-llama" || slug === "meta" || id.includes("/llama");
    default:
      return slug === family || slug.startsWith(`${family}-`);
  }
}

function isLowPriceModel(model: PickerModel): boolean {
  const prompt = priceValue(model.promptPrice);
  const completion = priceValue(model.completionPrice);
  if (prompt === undefined || completion === undefined) return false;
  return prompt <= 0.000001 && completion <= 0.000003;
}

function modelPriceScore(model: PickerModel): number {
  const prompt = priceValue(model.promptPrice);
  const completion = priceValue(model.completionPrice);
  if (prompt === undefined || completion === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return prompt + completion;
}

function openRouterModelMeta(model: PickerModel): string {
  const context =
    model.contextLength && model.contextLength > 0
      ? `${formatContextLength(model.contextLength)} ctx`
      : "ctx ?";
  const price = isFreeModel(model)
    ? "free"
    : `${formatPricePerMillion(model.promptPrice)}/${formatPricePerMillion(model.completionPrice)}`;
  return `${providerSlugFromModelId(model.id)} / ${context} / ${price}`;
}

function providerSlugFromModelId(modelId: string): string {
  return modelId.replace(/^openrouter\//, "").split("/")[0] ?? "unknown";
}

function formatContextLength(value: number): string {
  if (value >= 1000000) return `${Math.round(value / 1000000)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function formatPricePerMillion(value: string | null | undefined): string {
  const numeric = priceValue(value);
  if (numeric === undefined) return "$?";
  if (numeric === 0) return "$0";
  return `$${(numeric * 1000000).toFixed(numeric * 1000000 >= 1 ? 2 : 3)}`;
}

function priceValue(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}
