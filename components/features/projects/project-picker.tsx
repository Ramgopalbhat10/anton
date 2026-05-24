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

  const label = displayProject?.fullName ?? "project";

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
            "inline-flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
            className,
          )}
          aria-label={
            displayProject
              ? `Project ${displayProject.fullName}`
              : "Select project"
          }
          title={displayProject?.localPath}
        >
          <FolderGit2 className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={contentAlign}
        side="top"
        className="w-72 overflow-hidden p-0"
      >
        <div className="border-b border-border p-1.5">
          <div className="grid grid-cols-[0.75rem_1fr_auto] items-center gap-1.5 rounded-md bg-background/70 px-1.5 py-1 ring-1 ring-border">
            <Search className="size-3 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects"
              className="min-w-0 bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground"
              aria-label="Search projects"
            />
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={loading}
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
              aria-label="Refresh projects"
              title="Refresh projects"
            >
              {loading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
            </button>
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto p-0.5">
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
                      className="grid w-full grid-cols-[minmax(0,1fr)_0.75rem] items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {project.fullName}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">
                          {project.provider === "local" ? "Local" : "GitHub"}
                        </span>
                      </span>
                      {selected ? <Check className="size-3 text-primary" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
