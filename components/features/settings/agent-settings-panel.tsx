"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  SlidersHorizontal,
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
import type { PermissionMode } from "@/src/agent/permissions";
import type { WorkspaceSettingsSummary } from "@/src/lib/api-types";
import {
  DEFAULT_MODEL_ID,
  isSupportedModelId,
  MODEL_CATALOG,
  type ModelId,
} from "@/src/lib/models";
import {
  errorMessage,
  getJson,
  jsonHeaders,
  requestJson,
} from "@/src/lib/client-fetch";
import { notifyWorkspaceAgentDefaultsChanged } from "@/src/lib/client-state/workspace-agent-defaults";

import { SettingsCard, SettingsPageShell } from "./settings-shell";

const COMPACT_SELECT_TRIGGER_CLASS =
  "h-5 w-44 px-1.5 text-[11px] font-medium text-foreground hover:bg-primary/10";
const COMPACT_SELECT_CONTENT_CLASS = "min-w-36";
const COMPACT_SELECT_VIEWPORT_CLASS = "p-0.5";
const COMPACT_SELECT_ITEM_CLASS = "py-1 pr-7 pl-1.5";

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
  const [settings, setSettings] = useState<WorkspaceSettingsSummary | null>(null);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL_ID);
  const [maxSteps, setMaxSteps] = useState("");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("auto-review");
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
        setSettings(data.settings);
        setModel(
          data.settings.defaultModel &&
            isSupportedModelId(data.settings.defaultModel)
            ? data.settings.defaultModel
            : DEFAULT_MODEL_ID,
        );
        setMaxSteps(
          data.settings.defaultMaxSteps !== null
            ? String(data.settings.defaultMaxSteps)
            : "",
        );
        setPermissionMode(data.settings.defaultPermissionMode ?? "auto-review");
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

  const save = async () => {
    setSaving(true);
    try {
      const parsedMaxSteps = maxSteps.trim() ? Number(maxSteps.trim()) : null;
      if (
        parsedMaxSteps !== null &&
        (!Number.isInteger(parsedMaxSteps) ||
          parsedMaxSteps < 1 ||
          parsedMaxSteps > 50)
      ) {
        setError("Max steps must be an integer between 1 and 50.");
        return;
      }
      const data = await requestJson<{ settings: WorkspaceSettingsSummary }>(
        "/api/workspace-settings",
        {
          method: "PATCH",
          headers: jsonHeaders(),
          body: JSON.stringify({
            defaultModel: model,
            defaultMaxSteps: parsedMaxSteps,
            defaultPermissionMode: permissionMode,
          }),
        },
      );
      setSettings(data.settings);
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
      description="Set the default model, step budget cap, and approval strictness for new chat sessions."
    >
      {error ? (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      ) : null}
      {loading ? (
        <LoadingState label="Loading agent defaults..." />
      ) : (
        <div className="space-y-3">
          <SettingsCard title="Default model" icon={<SlidersHorizontal />}>
            <div className="max-w-sm">
              <Select value={model} onValueChange={(value) => setModel(value as ModelId)}>
                <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={COMPACT_SELECT_CONTENT_CLASS}>
                  <SelectViewport className={COMPACT_SELECT_VIEWPORT_CLASS}>
                    {MODEL_CATALOG.map((item) => (
                      <SelectItem
                        key={item.id}
                        value={item.id}
                        className={COMPACT_SELECT_ITEM_CLASS}
                      >
                        <span className="text-xs leading-4">{item.label}</span>
                      </SelectItem>
                    ))}
                  </SelectViewport>
                </SelectContent>
              </Select>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Used when a session has no saved composer override.
            </p>
          </SettingsCard>

          <SettingsCard title="Max steps">
            <div className="max-w-xs space-y-2">
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={maxSteps}
                placeholder="Profile default"
                onChange={(event) => {
                  const next = event.target.value.replace(/\D/g, "");
                  if (next === "" || Number(next) <= 50) {
                    setMaxSteps(next);
                  }
                }}
                aria-label="Default max steps"
                className="h-7 px-2 text-[11px] tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                Caps the agent step budget. Profile-specific limits may still be
                lower.
              </p>
            </div>
          </SettingsCard>

          <SettingsCard title="Approval strictness">
            <div className="max-w-sm">
              <Select
                value={permissionMode}
                onValueChange={(value) => setPermissionMode(value as PermissionMode)}
              >
                <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={COMPACT_SELECT_CONTENT_CLASS}>
                  <SelectViewport className={COMPACT_SELECT_VIEWPORT_CLASS}>
                    {PERMISSION_MODE_ITEMS.map((item) => (
                      <SelectItem
                        key={item.value}
                        value={item.value}
                        className={COMPACT_SELECT_ITEM_CLASS}
                      >
                        <span className="inline-flex items-center gap-1.5 text-xs leading-4">
                          <item.Icon className="size-3.5" />
                          {item.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectViewport>
                </SelectContent>
              </Select>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Default permission mode for new sessions. Composer controls still
              override per session.
            </p>
          </SettingsCard>

          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving..." : "Save defaults"}
            </Button>
            {settings ? (
              <span className="text-xs text-muted-foreground">
                Workspace root remains in Workspaces settings.
              </span>
            ) : null}
          </div>
        </div>
      )}
    </SettingsPageShell>
  );
}
