"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  FolderGit2,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ProjectSummary } from "@/src/lib/api-types";

export function ProjectPicker({
  projects,
  selectedProjectId,
  selectedProject,
  locked,
  disabled = false,
  loading,
  error,
  onSelect,
  onRefresh,
  className,
  contentAlign = "start",
  compact = false,
}: {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  selectedProject: ProjectSummary | null;
  locked: boolean;
  disabled?: boolean;
  loading: boolean;
  error: string | null;
  onSelect: (projectId: string) => void;
  onRefresh: () => void;
  className?: string;
  contentAlign?: "start" | "center" | "end";
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const displayProject =
    selectedProject ??
    (selectedProjectId
      ? projects.find((project) => project.id === selectedProjectId) ?? null
      : null);

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) =>
      [project.fullName, project.localPath, project.provider].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [projects, query]);

  const label = displayProject
    ? compact
      ? (displayProject.fullName.split("/").at(-1) ?? displayProject.fullName)
      : displayProject.fullName
    : "project";

  if (locked) {
    return (
      <span
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground",
          className,
        )}
        title={displayProject?.localPath}
      >
        <FolderGit2 className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        <Lock className="size-3 shrink-0 opacity-60" aria-hidden />
      </span>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void onRefresh();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
            className,
          )}
          aria-label={
            displayProject
              ? `Project ${displayProject.fullName}`
              : "Select project"
          }
          title={displayProject?.localPath}
        >
          <FolderGit2 className="size-[13px] shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={contentAlign}
        side="top"
        className="w-80 overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 border-b border-layout-border px-3 py-2.5">
          <Search className="size-[13px] shrink-0 text-muted-foreground/70" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
            aria-label="Search projects"
          />
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={loading}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
            aria-label="Refresh projects"
            title="Refresh projects"
          >
            {loading ? (
              <Loader2 className="size-[13px] animate-spin" />
            ) : (
              <RefreshCw className="size-[13px]" />
            )}
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          <div className="px-1.5 pb-1 pt-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
            Projects
          </div>
          {error ? (
            <div className="mx-1 rounded-md bg-destructive/10 px-1.5 py-1 text-[11px] text-destructive">
              {error}
            </div>
          ) : loading && projects.length === 0 ? (
            <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              Loading projects...
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              {projects.length === 0
                ? "No ready projects. Import or clone one in Settings."
                : "No projects match your search."}
            </div>
          ) : (
            <ul className="grid gap-0.5">
              {filteredProjects.map((project) => {
                const selected = project.id === selectedProjectId;
                return (
                  <li key={project.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(project.id);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "grid w-full grid-cols-[minmax(0,1fr)_0.875rem] items-center gap-2 rounded-md px-2 py-[7px] text-left transition-colors hover:bg-accent",
                        selected && "bg-accent",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-medium leading-4">
                          {project.fullName}
                        </span>
                        <span className="block truncate font-mono text-[10.5px] text-muted-foreground/80">
                          {project.provider === "github"
                            ? "GitHub"
                            : project.isGitRepository
                              ? "Local Git"
                              : "Local folder"}
                        </span>
                      </span>
                      {selected ? (
                        <Check className="size-3.5 text-primary" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-layout-border px-3 py-2 text-[12.5px] text-muted-foreground/70">
          <Settings className="size-3" />
          Manage projects in settings
        </div>
      </PopoverContent>
    </Popover>
  );
}
