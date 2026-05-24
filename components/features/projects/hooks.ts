"use client";

import { useCallback, useEffect, useState } from "react";

import type { ProjectGitStatusSummary, ProjectStatusSummary, ProjectSummary } from "@/src/lib/api-types";
import { errorMessage, getJson } from "@/src/lib/client-fetch";

export const PROJECT_GIT_CHANGED_EVENT = "anton-project-git-change";
const PROJECT_GIT_STATUS_POLL_INTERVAL_MS = 120_000;

export function useProjectsList(): {
  projects: ProjectSummary[];
  readyProjects: ProjectSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getJson<{ projects: ProjectSummary[] }>("/api/projects");
      setProjects(data.projects);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load projects"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial project list hydration updates state after async requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return {
    projects,
    readyProjects: projects.filter((project) => project.status === "ready"),
    loading,
    error,
    refresh,
  };
}

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

const PROJECT_STATUS_POLL_INTERVAL_MS = 120_000;

export function useProjectStatus(projectId: string | null): {
  status: ProjectStatusSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [loaded, setLoaded] = useState<{
    projectId: string;
    status: ProjectStatusSummary | null;
    error: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await getJson<{ status: ProjectStatusSummary }>(
        `/api/projects/${projectId}/status`,
      );
      setLoaded({ projectId, status: data.status, error: null });
    } catch (err) {
      setLoaded({
        projectId,
        status: null,
        error: err instanceof Error ? err.message : "Failed to load project status",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId) {
      queueMicrotask(() => setLoaded(null));
      return;
    }

    let cancelled = false;
    let pollTimeout: number | null = null;
    const load = async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const data = await getJson<{ status: ProjectStatusSummary }>(
          `/api/projects/${projectId}/status`,
        );
        if (!cancelled) {
          setLoaded({ projectId, status: data.status, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setLoaded({
            projectId,
            status: null,
            error:
              err instanceof Error ? err.message : "Failed to load project status",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const schedulePoll = () => {
      if (cancelled) return;
      pollTimeout = window.setTimeout(() => {
        void load().finally(schedulePoll);
      }, PROJECT_STATUS_POLL_INTERVAL_MS);
    };

    void load().finally(schedulePoll);
    const onProjectGitChanged = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        typeof event.detail === "string" &&
        event.detail === projectId
      ) {
        void load();
      }
    };
    window.addEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);
    return () => {
      cancelled = true;
      if (pollTimeout !== null) window.clearTimeout(pollTimeout);
      window.removeEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);
    };
  }, [projectId]);

  const isCurrent = loaded?.projectId === projectId;
  return {
    status: isCurrent ? loaded?.status ?? null : null,
    loading,
    error: isCurrent ? loaded?.error ?? null : null,
    refresh,
  };
}
