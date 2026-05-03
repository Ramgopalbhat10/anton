"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Check,
  GitBranch,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  GitHubRepositorySummary,
  ProjectSummary,
  WorkspaceSettingsSummary,
} from "@/src/lib/api-types";
import {
  errorMessage,
  getJson,
  jsonHeaders,
  requestJson,
} from "@/src/lib/client-fetch";
import { readActiveProjectId, writeActiveProjectId } from "./active-project";

interface WorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId: string | null;
  onActiveProjectChange: (projectId: string | null) => void;
}

export function WorkspaceDialog({
  open,
  onOpenChange,
  activeProjectId,
  onActiveProjectChange,
}: WorkspaceDialogProps) {
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
    // Fetching on open updates state after async requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

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

  const selectProject = (projectId: string) => {
    writeActiveProjectId(projectId);
    onActiveProjectChange(projectId);
  };

  if (!open) return null;

  const readyProjects = projects.filter((project) => project.status === "ready");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div className="flex h-[min(720px,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-card shadow-none ring-1 ring-border">
        <header className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
          <div className="min-w-0">
            <h2 id="workspace-dialog-title" className="text-xs font-semibold">
              Workspaces
            </h2>
            {settings && (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {settings.resolvedLocalWorkspacesRoot}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            aria-label="Close workspaces"
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <section className="space-y-2.5">
              <PanelTitle icon={<GitBranch />}>Local root</PanelTitle>
              <div className="rounded-md bg-background/45 p-2.5 ring-1 ring-border">
                <label className="text-xs font-medium" htmlFor="workspace-root">
                  Absolute path
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="workspace-root"
                    value={rootDraft}
                    onChange={(event) => setRootDraft(event.target.value)}
                    className="h-7 min-w-0 flex-1 rounded-md border-0 bg-secondary px-2.5 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                    placeholder="M:\\Projects\\anton-workspaces"
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
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Source: {settings.source}
                    {settings.exists ? " · ready" : " · will be created"}
                  </p>
                )}
              </div>

              <PanelTitle icon={<GitBranch />}>GitHub</PanelTitle>
              <div className="flex items-center gap-1.5 rounded-md bg-background/45 p-2.5 ring-1 ring-border">
                <Button type="button" size="sm" asChild>
                  <a href="/api/github/connect">
                    <GitBranch />
                    Connect GitHub
                  </a>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void refresh()}
                  disabled={loading}
                >
                  <RefreshCw className={cn(loading && "animate-spin")} />
                  Refresh
                </Button>
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive ring-1 ring-destructive/30">
                  {error}
                </div>
              )}
            </section>

            <section className="space-y-2.5">
              <PanelTitle>Ready projects</PanelTitle>
              {readyProjects.length === 0 ? (
                <EmptyState message="No cloned projects yet." />
              ) : (
                <ul className="space-y-1.5">
                  {readyProjects.map((project) => (
                    <li key={project.id}>
                      <button
                        type="button"
                        onClick={() => selectProject(project.id)}
                        className={cn(
                          "w-full rounded-md px-2.5 py-1.5 text-left text-xs ring-1 transition-colors",
                          activeProjectId === project.id
                            ? "bg-primary/10 ring-primary/50"
                            : "bg-background/45 ring-border hover:bg-accent",
                        )}
                      >
                        <span className="block font-medium">{project.fullName}</span>
                        <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                          {project.localPath}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="mt-4 space-y-2.5">
            <PanelTitle>Repositories</PanelTitle>
            {repositories.length === 0 ? (
              <EmptyState message="Connect GitHub and refresh to list repositories." />
            ) : (
              <ul className="grid gap-2 md:grid-cols-2">
                {repositories.map((repo) => (
                  <li
                    key={`${repo.installationId}:${repo.id}`}
                    className="rounded-md bg-background/45 p-2.5 text-xs ring-1 ring-border"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{repo.fullName}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {repo.private ? "private" : "public"} · {repo.defaultBranch}
                        </div>
                      </div>
                      {repo.clonedProjectId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (repo.clonedProjectId) {
                              selectProject(repo.clonedProjectId);
                            }
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
          </section>
        </div>
      </div>
    </div>
  );
}

export { readActiveProjectId };

function PanelTitle({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground [&_svg]:size-3.5">
      {icon}
      {children}
    </h3>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-background/35 px-2.5 py-3 text-xs text-muted-foreground ring-1 ring-border/70">
      {message}
    </div>
  );
}
