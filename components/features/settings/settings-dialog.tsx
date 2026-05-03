"use client";

import { useEffect, useState } from "react";

import { MemoryManager } from "@/components/features/project-context/memory-manager";
import { SkillsBrowser } from "@/components/features/project-context/skills-browser";

import {
  SettingsPageShell,
  SettingsShell,
  type SettingsSection,
} from "./settings-shell";
import { WorkspaceSettingsPanel } from "./workspace-settings-panel";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId: string | null;
  onActiveProjectChange: (projectId: string | null) => void;
  initialSection?: SettingsSection;
}

export function SettingsDialog({
  open,
  onOpenChange,
  activeProjectId,
  onActiveProjectChange,
  initialSection = "workspaces",
}: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);

  useEffect(() => {
    // Opening settings should reset the visible panel to the requested entry point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setSection(initialSection);
  }, [initialSection, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  if (!open) return null;

  return (
    <SettingsShell
      section={section}
      onSectionChange={setSection}
      onClose={() => onOpenChange(false)}
    >
      {section === "workspaces" && (
        <WorkspaceSettingsPanel
          activeProjectId={activeProjectId}
          onActiveProjectChange={onActiveProjectChange}
        />
      )}
      {section === "memories" && (
        <SettingsPageShell
          title="Memories"
          description="Store durable project preferences and facts that Anton should reuse across sessions."
        >
          <MemoryManager active />
        </SettingsPageShell>
      )}
      {section === "skills" && (
        <SettingsPageShell
          title="Skills"
          description="Review project-local skills available to Anton from the active workspace."
        >
          <SkillsBrowser active />
        </SettingsPageShell>
      )}
    </SettingsShell>
  );
}
