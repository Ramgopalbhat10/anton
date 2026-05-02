"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  FolderGit2,
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ProjectSummary } from "./workspace-dialog";

const ACTIVE_PROJECT_KEY = "anton.activeProjectId";

type SettingsSection = "workspaces" | "memories" | "skills";

type WorkspaceSettings = {
  localWorkspacesRoot: string | null;
  resolvedLocalWorkspacesRoot: string | null;
  source: "database" | "env" | "default";
  exists: boolean;
};

type GitHubRepository = {
  id: number;
  installationId: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  clonedProjectId: string | null;
};

type ProjectMemory = {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

type SkillSummary = {
  slug: string;
  name: string;
  description: string;
  path: string;
};

type SkillDocument = SkillSummary & {
  body: string;
};

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
            {section === "memories" && <MemorySettingsPanel active />}
            {section === "skills" && <SkillsSettingsPanel active />}
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
    // Initial panel hydration updates state after async requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const saveRoot = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/workspace-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ localWorkspacesRoot: rootDraft.trim() || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save root");
    } finally {
      setSaving(false);
    }
  };

  const selectProject = (projectId: string) => {
    localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    onActiveProjectChange(projectId);
    window.dispatchEvent(
      new CustomEvent("anton-active-project-change", { detail: projectId }),
    );
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
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
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
      </SettingsCard>
    </SettingsPageShell>
  );
}

function MemorySettingsPanel({ active }: { active: boolean }) {
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [memoryToDelete, setMemoryToDelete] = useState<ProjectMemory | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/memories", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { memories: ProjectMemory[] };
      setMemories(data.memories);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetching on panel activation updates state after the request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void loadMemories();
  }, [active, loadMemories]);

  const create = async () => {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDraft("");
      await loadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const update = async (id: string) => {
    const content = editingDraft.trim();
    if (!content) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditingId(null);
      setEditingDraft("");
      await loadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      setMemoryToDelete(null);
      await loadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPageShell
      title="Memories"
      description="Store durable project preferences and facts that Anton should reuse across sessions."
    >
      {error && <ErrorBanner message={error} />}
      <SettingsCard title="New memory">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={1000}
          placeholder="A durable project preference or fact."
          className="min-h-16 text-xs"
          aria-label="New memory"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {draft.trim().length}/1000
          </span>
          <Button
            type="button"
            size="sm"
            onClick={create}
            disabled={saving || draft.trim().length === 0}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Plus />}
            Add memory
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard title="Saved memories">
        {loading ? (
          <LoadingState label="Loading memories" />
        ) : memories.length === 0 ? (
          <EmptyState message="No project memories saved." />
        ) : (
          <ul className="space-y-1.5">
            {memories.map((memory) => {
              const editing = editingId === memory.id;
              return (
                <li
                  key={memory.id}
                  className="rounded-md bg-background/45 p-2.5 ring-1 ring-border"
                >
                  {editing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editingDraft}
                        onChange={(event) =>
                          setEditingDraft(event.target.value)
                        }
                        maxLength={1000}
                        className="min-h-16 text-xs"
                        aria-label="Edit memory"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(null);
                            setEditingDraft("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => update(memory.id)}
                          disabled={saving || editingDraft.trim().length === 0}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="whitespace-pre-wrap text-xs leading-normal">
                          {memory.content}
                        </p>
                        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                          {memory.id}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(memory.id);
                            setEditingDraft(memory.content);
                          }}
                          aria-label="Edit memory"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setMemoryToDelete(memory)}
                          aria-label="Delete memory"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SettingsCard>

      <AlertDialog
        open={memoryToDelete !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setMemoryToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete memory?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the selected project memory from future Anton
              sessions. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving || memoryToDelete === null}
              onClick={(event) => {
                event.preventDefault();
                if (memoryToDelete) void remove(memoryToDelete.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPageShell>
  );
}

function SkillsSettingsPanel({ active }: { active: boolean }) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [skillLoading, setSkillLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const loadSkills = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/skills", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          skills: SkillSummary[];
          warnings: string[];
        };
        setSkills(data.skills);
        setWarnings(data.warnings);
        setSelectedSlug((current) =>
          current && data.skills.some((skill) => skill.slug === current)
            ? current
            : data.skills[0]?.slug ?? null,
        );
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load skills");
      } finally {
        setLoading(false);
      }
    };
    void loadSkills();
  }, [active]);

  useEffect(() => {
    if (!selectedSlug) return;
    const loadSkill = async () => {
      setSkillLoading(true);
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(selectedSlug)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { skill: SkillDocument };
        setSelectedSkill(data.skill);
        setError(null);
      } catch (err) {
        setSelectedSkill(null);
        setError(err instanceof Error ? err.message : "Failed to load skill");
      } finally {
        setSkillLoading(false);
      }
    };
    void loadSkill();
  }, [selectedSlug]);

  return (
    <SettingsPageShell
      title="Skills"
      description="Review project-local skills available to Anton from the active workspace."
    >
      {error && <ErrorBanner message={error} />}
      {warnings.length > 0 && (
        <div className="rounded-md bg-amber-500/10 p-2.5 text-xs text-amber-300 ring-1 ring-amber-500/30">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <AlertTriangle className="size-3.5" />
            Skill warnings
          </div>
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid min-h-[440px] overflow-hidden rounded-md bg-card ring-1 ring-border lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-h-0 border-b border-border bg-background/25 p-2 lg:border-b-0 lg:border-r">
          {loading ? (
            <LoadingState label="Loading skills" />
          ) : skills.length === 0 ? (
            <EmptyState message="No workspace skills found." />
          ) : (
            <ul className="space-y-1">
              {skills.map((skill) => (
                <li key={skill.slug}>
                  <button
                    type="button"
                    onClick={() => setSelectedSlug(skill.slug)}
                    className={cn(
                      "w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      selectedSlug === skill.slug
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                    )}
                  >
                    <span className="block truncate font-medium">
                      {skill.name}
                    </span>
                    <span className="block truncate font-mono text-[10px]">
                      {skill.slug}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="min-h-0 overflow-y-auto p-3">
          {!selectedSlug ? (
            <EmptyState message="Select a skill to inspect it." />
          ) : skillLoading ? (
            <LoadingState label="Loading skill" />
          ) : selectedSkill ? (
            <article>
              <div className="mb-4">
                <h3 className="text-xs font-semibold">{selectedSkill.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedSkill.description || "No description."}
                </p>
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                  {selectedSkill.path}
                </p>
              </div>
              <pre className="max-h-[440px] overflow-auto rounded-md bg-background/60 p-2.5 text-xs leading-normal whitespace-pre-wrap ring-1 ring-border">
                {selectedSkill.body || "(empty)"}
              </pre>
            </article>
          ) : null}
        </section>
      </div>
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

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      {label}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-background/35 px-2.5 py-3 text-xs text-muted-foreground ring-1 ring-border/70">
      {message}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive ring-1 ring-destructive/30">
      {message}
    </div>
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
