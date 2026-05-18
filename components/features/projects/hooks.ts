"use client";

import { useEffect, useState } from "react";

import type { ProjectGitStatusSummary, ProjectSummary } from "@/src/lib/api-types";
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

export function useProjectGitStatus(
  projectId: string | null,
): ProjectGitStatusSummary | null {
  const [loadedStatus, setLoadedStatus] = useState<{
    projectId: string;
    status: ProjectGitStatusSummary | null;
  } | null>(null);

  useEffect(() => {
    if (!projectId) {
      queueMicrotask(() => setLoadedStatus(null));
      return;
    }

    let cancelled = false;
    const loadStatus = async () => {
      try {
        const data = await getJson<{ status: ProjectGitStatusSummary }>(
          `/api/projects/${projectId}/git/status`,
        );
        if (!cancelled) {
          setLoadedStatus({ projectId, status: data.status });
        }
      } catch {
        if (!cancelled) {
          setLoadedStatus({ projectId, status: null });
        }
      }
    };
    void loadStatus();
    const interval = window.setInterval(() => void loadStatus(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [projectId]);

  return loadedStatus?.projectId === projectId ? loadedStatus.status : null;
}
