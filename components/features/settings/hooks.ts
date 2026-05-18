"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  GitHubInstallationSummary,
  GitHubRepositorySummary,
  ProjectGitStatusSummary,
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
  const [installations, setInstallations] = useState<GitHubInstallationSummary[]>(
    [],
  );
  const [installationFilter, setInstallationFilter] = useState("all");
  const [repositories, setRepositories] = useState<GitHubRepositorySummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectGitStatuses, setProjectGitStatuses] = useState<
    Record<string, ProjectGitStatusSummary>
  >({});
  const [localPathDraft, setLocalPathDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloningRepoId, setCloningRepoId] = useState<number | null>(null);
  const [importingLocal, setImportingLocal] = useState(false);
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
  const [refreshingProjectId, setRefreshingProjectId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsData, projectsData, reposData] = await Promise.all([
        getJson<{ settings: WorkspaceSettingsSummary }>(
          "/api/workspace-settings",
        ),
        getJson<{ projects: ProjectSummary[] }>("/api/projects"),
        getJson<{
          installations: GitHubInstallationSummary[];
          repositories: GitHubRepositorySummary[];
        }>("/api/github/repositories").catch(() => null),
      ]);

      setSettings(settingsData.settings);
      setRootDraft(
        settingsData.settings.localWorkspacesRoot ??
          settingsData.settings.resolvedLocalWorkspacesRoot ??
          "",
      );
      setProjects(projectsData.projects);
      const gitStatuses = await Promise.all(
        projectsData.projects
          .filter((project) => project.status === "ready")
          .map((project) =>
            getJson<{ status: ProjectGitStatusSummary }>(
              `/api/projects/${project.id}/git/status`,
            )
              .then((data) => [project.id, data.status] as const)
              .catch(() => null),
          ),
      );
      setProjectGitStatuses(
        Object.fromEntries(
          gitStatuses.filter(
            (entry): entry is readonly [string, ProjectGitStatusSummary] =>
              entry !== null,
          ),
        ),
      );
      setInstallations(reposData?.installations ?? []);
      setRepositories(reposData?.repositories ?? []);
      setInstallationFilter((current) => {
        if (current === "all") return current;
        return reposData?.installations.some(
          (installation) => String(installation.installationId) === current,
        )
          ? current
          : "all";
      });
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

  const importLocalProject = async () => {
    const localPath = localPathDraft.trim();
    if (!localPath) return;

    setImportingLocal(true);
    try {
      const data = await requestJson<{ project: ProjectSummary }>("/api/projects", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ source: "local", localPath }),
      });
      setLocalPathDraft("");
      selectProject(data.project.id);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Import failed"));
    } finally {
      setImportingLocal(false);
    }
  };

  const removeProject = async (projectId: string, activeProjectId: string | null) => {
    setRemovingProjectId(projectId);
    try {
      await requestJson<{ project: ProjectSummary }>(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (activeProjectId === projectId) {
        writeActiveProjectId(null);
        onActiveProjectChange(null);
      }
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Project removal failed"));
    } finally {
      setRemovingProjectId(null);
    }
  };

  const refreshProject = async (projectId: string) => {
    setRefreshingProjectId(projectId);
    try {
      const data = await requestJson<{ project: ProjectSummary }>(
        `/api/projects/${projectId}/refresh`,
        { method: "POST" },
      );
      setProjects((current) =>
        current.map((project) =>
          project.id === data.project.id ? data.project : project,
        ),
      );
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Project refresh failed"));
    } finally {
      setRefreshingProjectId(null);
    }
  };

  const filteredRepositories =
    installationFilter === "all"
      ? repositories
      : repositories.filter(
          (repo) => String(repo.installationId) === installationFilter,
        );

  return {
    settings,
    rootDraft,
    setRootDraft,
    localPathDraft,
    setLocalPathDraft,
    installations,
    installationFilter,
    setInstallationFilter,
    repositories,
    filteredRepositories,
    projects,
    projectGitStatuses,
    readyProjects: projects.filter((project) => project.status === "ready"),
    loading,
    saving,
    cloningRepoId,
    importingLocal,
    removingProjectId,
    refreshingProjectId,
    error,
    refresh,
    saveRoot,
    selectProject,
    cloneRepo,
    importLocalProject,
    removeProject,
    refreshProject,
  };
}
