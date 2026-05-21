"use client";

import { useEffect, useState } from "react";

import type { ProjectGitStatusSummary, ProjectSummary } from "@/src/lib/api-types";
import { getJson } from "@/src/lib/client-fetch";

export const PROJECT_GIT_CHANGED_EVENT = "anton-project-git-change";
const PROJECT_GIT_STATUS_POLL_INTERVAL_MS = 120_000;

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
    let loading = false;
    let pollTimeout: number | null = null;
    const loadStatus = async () => {
      if (loading) return;
      loading = true;
      try {
        const data = await getJson<{ status: ProjectGitStatusSummary }>(
          `/api/projects/${projectId}/git/status`,
        );
        if (!cancelled) {
          setLoadedStatus({ projectId, status: data.status });
        }
      } catch {
        if (!cancelled) {
          setLoadedStatus((current) =>
            current?.projectId === projectId ? current : { projectId, status: null },
          );
        }
      } finally {
        loading = false;
      }
    };
    const schedulePoll = () => {
      if (cancelled) return;
      pollTimeout = window.setTimeout(() => {
        void loadStatus().finally(schedulePoll);
      }, PROJECT_GIT_STATUS_POLL_INTERVAL_MS);
    };

    void loadStatus().finally(schedulePoll);
    const onProjectGitChanged = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        typeof event.detail === "string" &&
        event.detail === projectId
      ) {
        void loadStatus();
      }
    };
    window.addEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);
    return () => {
      cancelled = true;
      if (pollTimeout !== null) {
        window.clearTimeout(pollTimeout);
      }
      window.removeEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);
    };
  }, [projectId]);

  return loadedStatus?.projectId === projectId ? loadedStatus.status : null;
}

export function notifyProjectGitChanged(projectId: string): void {
  window.dispatchEvent(new CustomEvent(PROJECT_GIT_CHANGED_EVENT, { detail: projectId }));
}
