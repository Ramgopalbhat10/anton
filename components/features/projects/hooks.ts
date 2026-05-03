"use client";

import { useEffect, useState } from "react";

import type { ProjectSummary } from "@/src/lib/api-types";
import { getJson } from "@/src/lib/client-fetch";

export function useProjectSummary(projectId: string | null): ProjectSummary | null {
  const [loadedProject, setLoadedProject] = useState<{
    projectId: string;
    project: ProjectSummary | null;
  } | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const loadProject = async () => {
      try {
        const data = await getJson<{ project: ProjectSummary }>(
          `/api/projects/${projectId}`,
        );
        setLoadedProject({ projectId, project: data.project });
      } catch {
        setLoadedProject({ projectId, project: null });
      }
    };
    void loadProject();
  }, [projectId]);

  return loadedProject?.projectId === projectId ? loadedProject.project : null;
}
