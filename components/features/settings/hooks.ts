"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  GitHubRepositorySummary,
  ProjectSummary,
  WorkspaceSettingsSummary,
} from "@/src/lib/api-types";
import { writeActiveProjectId } from "@/src/lib/client-state/active-project";
import {
  errorMessage,
  getJson,
  jsonHeaders,
  requestJson,
} from "@/src/lib/client-fetch";

export function useWorkspaceSettings(
  onActiveProjectChange: (projectId: string | null) => void,
) {
  const [settings, setSettings] = useState<WorkspaceSettingsSummary | null>(null);
  const [rootDraft, setRootDraft] = useState("");
  const [repositories, setRepositories] = useState<GitHubRepositorySummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloningRepoId, setCloningRepoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsData, projectsData, reposData] = await Promise.all([
        getJson<{ settings: WorkspaceSettingsSummary }>(
          "/api/workspace-settings",
        ),
        getJson<{ projects: ProjectSummary[] }>("/api/projects"),
        getJson<{ repositories: GitHubRepositorySummary[] }>(
          "/api/github/repositories",
        ).catch(() => null),
      ]);

      setSettings(settingsData.settings);
      setRootDraft(
        settingsData.settings.localWorkspacesRoot ??
          settingsData.settings.resolvedLocalWorkspacesRoot ??
          "",
      );
      setProjects(projectsData.projects);
      setRepositories(reposData?.repositories ?? []);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load workspaces"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial panel hydration updates state after async requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const saveRoot = async () => {
    setSaving(true);
    try {
      await requestJson<{ settings: WorkspaceSettingsSummary }>(
        "/api/workspace-settings",
        {
          method: "PATCH",
          headers: jsonHeaders(),
          body: JSON.stringify({ localWorkspacesRoot: rootDraft.trim() || null }),
        },
      );
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to save root"));
    } finally {
      setSaving(false);
    }
  };

  const selectProject = (projectId: string) => {
    writeActiveProjectId(projectId);
    onActiveProjectChange(projectId);
  };

  const cloneRepo = async (repo: GitHubRepositorySummary) => {
    setCloningRepoId(repo.id);
    try {
      const data = await requestJson<{ project: ProjectSummary }>("/api/projects", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          repositoryId: repo.id,
          installationId: repo.installationId,
        }),
      });
      selectProject(data.project.id);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Clone failed"));
    } finally {
      setCloningRepoId(null);
    }
  };

  return {
    settings,
    rootDraft,
    setRootDraft,
    repositories,
    projects,
    readyProjects: projects.filter((project) => project.status === "ready"),
    loading,
    saving,
    cloningRepoId,
    error,
    refresh,
    saveRoot,
    selectProject,
    cloneRepo,
  };
}
