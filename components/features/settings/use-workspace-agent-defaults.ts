"use client";

import { useCallback, useEffect, useState } from "react";

import type { WorkspaceAgentDefaults } from "@/src/lib/client-state/workspace-agent-defaults";
import {
  fetchWorkspaceAgentDefaults,
  WORKSPACE_AGENT_DEFAULTS_CHANGED_EVENT,
  workspaceDefaultsFromSettings,
} from "@/src/lib/client-state/workspace-agent-defaults";
import type { WorkspaceSettingsSummary } from "@/src/lib/api-types";

export function useWorkspaceAgentDefaults(): WorkspaceAgentDefaults | null {
  const [defaults, setDefaults] = useState<WorkspaceAgentDefaults | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDefaults(await fetchWorkspaceAgentDefaults());
    } catch {
      setDefaults(null);
    }
  }, []);

  useEffect(() => {
    // Initial defaults hydration updates state after async requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const onChanged = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const settings = event.detail as WorkspaceSettingsSummary | undefined;
      if (settings) {
        setDefaults(workspaceDefaultsFromSettings(settings));
        return;
      }
      void refresh();
    };
    window.addEventListener(WORKSPACE_AGENT_DEFAULTS_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(WORKSPACE_AGENT_DEFAULTS_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  return defaults;
}
