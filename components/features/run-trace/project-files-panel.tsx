"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FolderTree,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  type UseFileTreeResult,
} from "@pierre/trees/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, getJson } from "@/src/lib/client-fetch";
import type {
  ProjectFileTreeSummary,
  ProjectSummary,
} from "@/src/lib/api-types";
import { cn } from "@/lib/utils";

type ProjectFileTreeState = {
  fileTree: ProjectFileTreeSummary | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
};

export function ProjectFilesPanel({
  project,
  visible,
}: {
  project: ProjectSummary | null;
  visible: boolean;
}) {
  const state = useProjectFileTree(project, { enabled: visible });
  const readyProject = project?.status === "ready";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="border-b border-border px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase text-muted-foreground">
              Active project
            </div>
            <h2 className="mt-1 truncate text-sm font-semibold">
              {project?.fullName ?? "No project selected"}
            </h2>
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
              {project?.localPath ?? "Select a workspace to browse files"}
            </p>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={state.refresh}
            disabled={!readyProject || state.loading || state.refreshing}
            aria-label="Refresh file tree"
            title="Refresh file tree"
          >
            {state.loading || state.refreshing ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
          </Button>
        </div>
        {state.fileTree ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <span className="rounded bg-secondary px-1.5 py-0.5">
              {state.fileTree.totalCount.toLocaleString()} files
            </span>
            {state.fileTree.truncated ? (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
                Showing first {state.fileTree.paths.length.toLocaleString()}
              </span>
            ) : null}
          </div>
        ) : null}
        {state.error ? (
          <div className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            {state.error}
          </div>
        ) : null}
      </section>

      {!project ? (
        <ProjectFilesEmptyState message="Select an active project to browse files." />
      ) : !readyProject ? (
        <ProjectFilesEmptyState message="Project files are available after the workspace is ready." />
      ) : state.loading ? (
        <ProjectFilesEmptyState message="Loading project files..." loading />
      ) : state.fileTree && state.fileTree.paths.length > 0 ? (
        <ProjectFileTree paths={state.fileTree.paths} totalCount={state.fileTree.totalCount} />
      ) : (
        <ProjectFilesEmptyState message="No files found in this project." />
      )}
    </div>
  );
}

function ProjectFileTree({
  paths,
  totalCount,
}: {
  paths: readonly string[];
  totalCount: number;
}) {
  const sortedPaths = useMemo(() => [...paths].sort(), [paths]);
  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    paths: sortedPaths,
    search: true,
  });

  useEffect(() => {
    model.resetPaths(sortedPaths, { initialExpandedPaths: [] });
    model.closeSearch();
  }, [model, sortedPaths]);

  return (
    <>
      <ProjectFileTreeSearch model={model} totalCount={totalCount} />
      <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
        <FileTree
          model={model}
          className="anton-file-tree h-full overflow-hidden rounded-md border border-border bg-background/45"
          aria-label="Project file tree"
        />
      </div>
    </>
  );
}

function ProjectFileTreeSearch({
  model,
  totalCount,
}: {
  model: UseFileTreeResult["model"];
  totalCount: number;
}) {
  const search = useFileTreeSearch(model);
  const matchingCount = search.value.length > 0 ? search.matchingPaths.length : totalCount;
  const onSearch = useCallback(
    (value: string) => {
      if (value.length > 0 && !search.isOpen) {
        search.open(value);
        return;
      }
      search.setValue(value.length > 0 ? value : null);
    },
    [search],
  );

  return (
    <div className="border-b border-border px-3 py-2">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search.value}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search files"
            className="h-7 pl-7 pr-7 font-mono text-[11px]"
            aria-label="Search project files"
          />
          {search.value ? (
            <button
              type="button"
              onClick={() => search.setValue(null)}
              className="absolute right-1.5 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Clear file search"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={search.focusPreviousMatch}
            disabled={!search.value || search.matchingPaths.length === 0}
            aria-label="Previous file search match"
            title="Previous match"
          >
            <ChevronUp />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={search.focusNextMatch}
            disabled={!search.value || search.matchingPaths.length === 0}
            aria-label="Next file search match"
            title="Next match"
          >
            <ChevronDown />
          </Button>
        </div>
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-[10px]",
          search.value && matchingCount === 0
            ? "text-destructive"
            : "text-muted-foreground",
        )}
      >
        {search.value
          ? `${matchingCount.toLocaleString()} match${matchingCount === 1 ? "" : "es"}`
          : `${totalCount.toLocaleString()} files`}
      </div>
    </div>
  );
}

function ProjectFilesEmptyState({
  message,
  loading = false,
}: {
  message: string;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
      <div className="flex max-w-64 flex-col items-center gap-2">
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FolderTree className="size-4" />
        )}
        <span>{message}</span>
      </div>
    </div>
  );
}

function useProjectFileTree(
  project: ProjectSummary | null,
  options: { enabled: boolean },
): ProjectFileTreeState {
  const [fileTree, setFileTree] = useState<ProjectFileTreeSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectId = project?.status === "ready" ? project.id : null;

  const loadFileTree = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!projectId) return;
      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        const data = await getJson<{ fileTree: ProjectFileTreeSummary }>(
          `/api/projects/${projectId}/files`,
        );
        setFileTree(data.fileTree);
      } catch (err) {
        setError(errorMessage(err, "Failed to load project files"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (!options.enabled || !projectId) {
      queueMicrotask(() => {
        setFileTree(null);
        setLoading(false);
        setRefreshing(false);
        setError(null);
      });
      return;
    }
    queueMicrotask(() => void loadFileTree("initial"));
  }, [loadFileTree, options.enabled, projectId]);

  return {
    fileTree,
    loading,
    refreshing,
    error,
    refresh: () => void loadFileTree(fileTree ? "refresh" : "initial"),
  };
}
