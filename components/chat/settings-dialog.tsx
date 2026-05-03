"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  FolderGit2,
  GitBranch,
  Loader2,
  RefreshCw,
  Search,
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
import { EmptyState, ErrorBanner } from "./feedback-states";
import { MemoryManager } from "./memory-manager";
import { SkillsBrowser } from "./skills-browser";
import { writeActiveProjectId } from "./active-project";

type SettingsSection = "workspaces" | "memories" | "skills";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId: string | null;
  onActiveProjectChange: (projectId: string | null) => void;
  initialSection?: SettingsSection;
}

export function SettingsDialog({
  open,
  onOpenChange,
  activeProjectId,
  onActiveProjectChange,
  initialSection = "workspaces",
}: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);

  useEffect(() => {
    // Opening settings should reset the visible panel to the requested entry point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setSection(initialSection);
  }, [initialSection, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div className="grid h-dvh min-h-0 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 border-r border-border bg-sidebar md:flex md:flex-col">
          <div className="border-b border-border px-3 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 mb-3 h-6 text-xs text-muted-foreground"
              onClick={() => onOpenChange(false)}
            >
              <ChevronLeft />
              Back
            </Button>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                className="h-8 w-full rounded-md bg-secondary pl-8 pr-2.5 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                placeholder="Search settings..."
              />
            </label>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto p-2">
            <SettingsGroup title="Workspace">
              <SettingsNavButton
                active={section === "workspaces"}
                onClick={() => setSection("workspaces")}
              >
                Workspaces
              </SettingsNavButton>
            </SettingsGroup>
            <SettingsGroup title="Project context">
              <SettingsNavButton
                active={section === "memories"}
                onClick={() => setSection("memories")}
              >
                Memories
              </SettingsNavButton>
              <SettingsNavButton
                active={section === "skills"}
                onClick={() => setSection("skills")}
              >
                Skills
              </SettingsNavButton>
            </SettingsGroup>
          </nav>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col bg-background">
          <header className="flex h-10 items-center justify-between border-b border-border px-3 md:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden text-xs text-muted-foreground md:inline">
                Settings
              </span>
              <span className="hidden text-muted-foreground md:inline">/</span>
              <h1 id="settings-title" className="truncate text-xs font-semibold">
                {sectionTitle(section)}
              </h1>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
              aria-label="Close settings"
            >
              <X />
            </Button>
          </header>

          <div className="flex gap-1.5 overflow-x-auto border-b border-border px-2 py-1.5 md:hidden">
            <MobileTab
              active={section === "workspaces"}
              onClick={() => setSection("workspaces")}
            >
              Workspaces
            </MobileTab>
            <MobileTab
              active={section === "memories"}
              onClick={() => setSection("memories")}
            >
              Memories
            </MobileTab>
            <MobileTab
              active={section === "skills"}
              onClick={() => setSection("skills")}
            >
              Skills
            </MobileTab>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 md:px-8">
            {section === "workspaces" && (
              <WorkspaceSettingsPanel
                activeProjectId={activeProjectId}
                onActiveProjectChange={onActiveProjectChange}
              />
            )}
            {section === "memories" && (
              <SettingsPageShell
                title="Memories"
                description="Store durable project preferences and facts that Anton should reuse across sessions."
              >
                <MemoryManager active variant="settings" />
              </SettingsPageShell>
            )}
            {section === "skills" && (
              <SettingsPageShell
                title="Skills"
                description="Review project-local skills available to Anton from the active workspace."
              >
                <SkillsBrowser active variant="settings" />
              </SettingsPageShell>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-4">
      <h2 className="mb-1.5 px-2 text-[11px] font-medium text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function SettingsNavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 w-full items-center rounded-md px-2 text-left text-xs font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-foreground hover:bg-sidebar-accent/70",
      )}
    >
      {children}
    </button>
  );
}

function MobileTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium",
        active ? "bg-secondary text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function WorkspaceSettingsPanel({
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

function SettingsPageShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-3">
      <div className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function SettingsCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md bg-card p-3 ring-1 ring-border">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold [&_svg]:size-4">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function sectionTitle(section: SettingsSection): string {
  switch (section) {
    case "workspaces":
      return "Workspaces";
    case "memories":
      return "Memories";
    case "skills":
      return "Skills";
  }
}
