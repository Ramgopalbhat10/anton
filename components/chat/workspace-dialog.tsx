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

const ACTIVE_PROJECT_KEY = "anton.activeProjectId";

type WorkspaceSettings = {
  localWorkspacesRoot: string | null;
  resolvedLocalWorkspacesRoot: string | null;
  source: "database" | "env" | "default";
  exists: boolean;
};

type GitHubRepository = {
  id: number;
  installationId: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  clonedProjectId: string | null;
  cloneStatus: "cloning" | "ready" | "error" | null;
};

export type ProjectSummary = {
  id: string;
  provider: "github";
  githubRepoId: number;
  githubInstallationId: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string;
  localPath: string;
  status: "cloning" | "ready" | "error";
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

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
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [rootDraft, setRootDraft] = useState("");
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloningRepoId, setCloningRepoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, projectsRes, reposRes] = await Promise.all([
        fetch("/api/workspace-settings", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/github/repositories", { cache: "no-store" }),
      ]);

      if (!settingsRes.ok) throw new Error(`Settings HTTP ${settingsRes.status}`);
      if (!projectsRes.ok) throw new Error(`Projects HTTP ${projectsRes.status}`);

      const settingsData = (await settingsRes.json()) as {
        settings: WorkspaceSettings;
      };
      const projectsData = (await projectsRes.json()) as {
        projects: ProjectSummary[];
      };
      setSettings(settingsData.settings);
      setRootDraft(
        settingsData.settings.localWorkspacesRoot ??
          settingsData.settings.resolvedLocalWorkspacesRoot ??
          "",
      );
      setProjects(projectsData.projects);

      if (reposRes.ok) {
        const reposData = (await reposRes.json()) as {
          repositories: GitHubRepository[];
        };
        setRepositories(reposData.repositories);
      } else {
        setRepositories([]);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspaces");
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
      const res = await fetch("/api/workspace-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ localWorkspacesRoot: rootDraft.trim() || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save root");
    } finally {
      setSaving(false);
    }
  };

  const cloneRepo = async (repo: GitHubRepository) => {
    setCloningRepoId(repo.id);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repositoryId: repo.id,
          installationId: repo.installationId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { project: ProjectSummary };
      selectProject(data.project.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setCloningRepoId(null);
    }
  };

  const selectProject = (projectId: string) => {
    localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    onActiveProjectChange(projectId);
    window.dispatchEvent(
      new CustomEvent("anton-active-project-change", { detail: projectId }),
    );
  };

  if (!open) return null;

  const readyProjects = projects.filter((project) => project.status === "ready");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div className="flex h-[min(760px,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="workspace-dialog-title" className="text-sm font-semibold">
              Workspaces
            </h2>
            {settings && (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {settings.resolvedLocalWorkspacesRoot}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Close workspaces"
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
            <section className="space-y-3">
              <PanelTitle icon={<GitBranch />}>Local root</PanelTitle>
              <div className="rounded-md border border-border p-3">
                <label className="text-xs font-medium" htmlFor="workspace-root">
                  Absolute path
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="workspace-root"
                    value={rootDraft}
                    onChange={(event) => setRootDraft(event.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
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
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Source: {settings.source}
                    {settings.exists ? " · ready" : " · will be created"}
                  </p>
                )}
              </div>

              <PanelTitle icon={<GitBranch />}>GitHub</PanelTitle>
              <div className="flex items-center gap-2 rounded-md border border-border p-3">
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
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <PanelTitle>Ready projects</PanelTitle>
              {readyProjects.length === 0 ? (
                <EmptyState message="No cloned projects yet." />
              ) : (
                <ul className="space-y-2">
                  {readyProjects.map((project) => (
                    <li key={project.id}>
                      <button
                        type="button"
                        onClick={() => selectProject(project.id)}
                        className={cn(
                          "w-full rounded-md border px-3 py-2 text-left text-xs",
                          activeProjectId === project.id
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-accent",
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

          <section className="mt-5 space-y-3">
            <PanelTitle>Repositories</PanelTitle>
            {repositories.length === 0 ? (
              <EmptyState message="Connect GitHub and refresh to list repositories." />
            ) : (
              <ul className="grid gap-2 md:grid-cols-2">
                {repositories.map((repo) => (
                  <li
                    key={`${repo.installationId}:${repo.id}`}
                    className="rounded-md border border-border p-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{repo.fullName}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {repo.private ? "private" : "public"} · {repo.defaultBranch}
                        </div>
                      </div>
                      {repo.clonedProjectId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => selectProject(repo.clonedProjectId as string)}
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

export function readActiveProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_PROJECT_KEY);
}

function PanelTitle({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {icon}
      {children}
    </h3>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
      {message}
    </div>
  );
}
