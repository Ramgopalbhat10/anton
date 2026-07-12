"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  FilesystemBrowseResult,
  GitHubInstallationSummary,
  GitHubRepositorySummary,
  ProjectGitStatusSummary,
  ProjectSummary,
  WorkspaceSettingsSummary,
} from "@/src/lib/api-types";
import {
  errorMessage,
  getJson,
  jsonHeaders,
  requestJson,
} from "@/src/lib/client-fetch";

export function useWorkspaceSettings() {
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
  const [browse, setBrowse] = useState<FilesystemBrowseResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloningRepoId, setCloningRepoId] = useState<number | null>(null);
  const [importingLocal, setImportingLocal] = useState(false);
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
  const [refreshingProjectId, setRefreshingProjectId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const loadBrowse = useCallback(async (path?: string | null) => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const query =
        path && path.trim().length > 0
          ? `?path=${encodeURIComponent(path.trim())}`
          : "";
      const data = await getJson<{ browse: FilesystemBrowseResult }>(
        `/api/filesystem/browse${query}`,
      );
      setBrowse(data.browse);
      if (data.browse.currentPath) {
        setLocalPathDraft(data.browse.currentPath);
      }
    } catch (err) {
      setBrowseError(errorMessage(err, "Failed to browse folders"));
    } finally {
      setBrowseLoading(false);
    }
  }, []);

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
          .filter(
            (project) => project.status === "ready" && project.isGitRepository,
          )
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
          (installation) => installationKey(installation.installationId) === current,
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
    void loadBrowse(null);
  }, [refresh, loadBrowse]);

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

  const cloneRepo = async (repo: GitHubRepositorySummary) => {
    setCloningRepoId(repo.id);
    try {
      await requestJson<{ project: ProjectSummary }>("/api/projects", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          repositoryId: repo.id,
          installationId: repo.installationId,
        }),
      });
      await refresh();
    } catch (err) {
      const message = errorMessage(err, "Clone failed");
      await refresh().catch(() => null);
      setError(message);
    } finally {
      setCloningRepoId(null);
    }
  };

  const importLocalProject = async () => {
    const localPath = localPathDraft.trim();
    if (!localPath) return;

    setImportingLocal(true);
    try {
      await requestJson<{ project: ProjectSummary }>("/api/projects", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ source: "local", localPath }),
      });
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Import failed"));
    } finally {
      setImportingLocal(false);
    }
  };

  const removeProject = async (projectId: string) => {
    setRemovingProjectId(projectId);
    try {
      await requestJson<{ project: ProjectSummary }>(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
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
          (repo) => installationKey(repo.installationId) === installationFilter,
        );

  return {
    settings,
    rootDraft,
    setRootDraft,
    localPathDraft,
    setLocalPathDraft,
    browse,
    browseLoading,
    browseError,
    loadBrowse,
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
    cloneRepo,
    importLocalProject,
    removeProject,
    refreshProject,
  };
}

function installationKey(installationId: number | null): string {
  return installationId === null ? "pat" : String(installationId);
}
