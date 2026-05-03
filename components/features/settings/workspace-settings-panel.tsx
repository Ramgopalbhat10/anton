"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, FolderGit2, GitBranch, Loader2, RefreshCw } from "lucide-react";

import { EmptyState, ErrorBanner } from "@/components/shared/feedback-states";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  GitHubRepositorySummary,
  ProjectSummary,
  WorkspaceSettingsSummary,
} from "@/src/lib/api-types";
import { errorMessage, getJson, jsonHeaders, requestJson } from "@/src/lib/client-fetch";

import { writeActiveProjectId } from "./active-project";
import { SettingsCard, SettingsPageShell } from "./settings-shell";

export function WorkspaceSettingsPanel({
  activeProjectId,
  onActiveProjectChange,
}: {
  activeProjectId: string | null;
  onActiveProjectChange: (projectId: string | null) => void;
}) {
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

  const readyProjects = projects.filter((project) => project.status === "ready");

  return (
    <SettingsPageShell
      title="Workspaces"
      description="Choose where Anton clones repositories and which workspace new sessions use."
    >
      {error && <ErrorBanner message={error} />}
      <SettingsCard title="Local workspace root" icon={<FolderGit2 />}>
        <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
          <input
            value={rootDraft}
            onChange={(event) => setRootDraft(event.target.value)}
            className="h-7 min-w-0 rounded-md bg-secondary px-2.5 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            placeholder="M:\\Projects\\anton-workspaces"
            aria-label="Local workspace root"
          />
          <Button
            type="button"
            size="sm"
            onClick={saveRoot}
            disabled={saving || rootDraft.trim().length === 0}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            Save
          </Button>
        </div>
        {settings && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Current:{" "}
            <span className="font-mono">{settings.resolvedLocalWorkspacesRoot}</span>
            {" · "}
            {settings.source}
            {settings.exists ? " · ready" : " · will be created"}
          </p>
        )}
      </SettingsCard>

      <SettingsCard title="Active project" icon={<GitBranch />}>
        {readyProjects.length === 0 ? (
          <EmptyState message="No cloned projects yet." />
        ) : (
          <ul className="grid gap-2">
            {readyProjects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => selectProject(project.id)}
                  className={cn(
                    "w-full rounded-md p-2.5 text-left ring-1 transition-colors",
                    activeProjectId === project.id
                      ? "bg-primary/10 ring-primary/50"
                      : "bg-background/45 ring-border hover:bg-accent",
                  )}
                >
                  <span className="block text-xs font-medium">
                    {project.fullName}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                    {project.localPath}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard
        title="GitHub repositories"
        icon={<GitBranch />}
        action={
          <div className="flex items-center gap-1.5">
            <Button type="button" size="sm" variant="outline" asChild>
              <a href="/api/github/connect">Connect GitHub</a>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw className={cn(loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      >
        {repositories.length === 0 ? (
          <EmptyState message="Connect GitHub and refresh to list repositories." />
        ) : (
          <ul className="grid gap-2 lg:grid-cols-2">
            {repositories.map((repo) => (
              <li
                key={`${repo.installationId}:${repo.id}`}
                className="rounded-md bg-background/45 p-2.5 ring-1 ring-border"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">
                      {repo.fullName}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {repo.private ? "Private" : "Public"} · {repo.defaultBranch}
                    </div>
                  </div>
                  {repo.clonedProjectId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (repo.clonedProjectId) selectProject(repo.clonedProjectId);
                      }}
                    >
                      Select
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void cloneRepo(repo)}
                      disabled={cloningRepoId === repo.id}
                    >
                      {cloningRepoId === repo.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <GitBranch />
                      )}
                      Clone
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </SettingsPageShell>
  );
}
