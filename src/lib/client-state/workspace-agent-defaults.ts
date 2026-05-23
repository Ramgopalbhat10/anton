"use client";

import type { PermissionMode } from "@/src/agent/permissions";
import type { WorkspaceSettingsSummary } from "@/src/lib/api-types";
import {
  DEFAULT_MODEL_ID,
  isSupportedModelId,
  type ModelId,
} from "@/src/lib/models";
import { getJson } from "@/src/lib/client-fetch";

export const WORKSPACE_AGENT_DEFAULTS_CHANGED_EVENT =
  "anton-workspace-agent-defaults-change";

export type WorkspaceAgentDefaults = {
  model: ModelId;
  permissionMode: PermissionMode;
  maxSteps: number | null;
};

export function workspaceDefaultsFromSettings(
  settings: WorkspaceSettingsSummary,
): WorkspaceAgentDefaults {
  return {
    model:
      settings.defaultModel && isSupportedModelId(settings.defaultModel)
        ? settings.defaultModel
        : DEFAULT_MODEL_ID,
    permissionMode: settings.defaultPermissionMode ?? "auto-review",
    maxSteps: settings.defaultMaxSteps,
  };
}

export async function fetchWorkspaceAgentDefaults(): Promise<WorkspaceAgentDefaults> {
  const data = await getJson<{ settings: WorkspaceSettingsSummary }>(
    "/api/workspace-settings",
  );
  return workspaceDefaultsFromSettings(data.settings);
}

export function notifyWorkspaceAgentDefaultsChanged(
  settings: WorkspaceSettingsSummary,
): void {
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_AGENT_DEFAULTS_CHANGED_EVENT, {
      detail: settings,
    }),
  );
}
