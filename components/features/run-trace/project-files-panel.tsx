"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileCode2,
  FolderTree,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import type { GitStatusEntry } from "@pierre/trees";
import type { CSSProperties } from "react";
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
} from "@pierre/trees/react";

import { Button } from "@/components/ui/button";
import { errorMessage, getJson } from "@/src/lib/client-fetch";
import type {
  ProjectFileContentSummary,
  ProjectFileTreeSummary,
  ProjectSummary,
} from "@/src/lib/api-types";
import { cn } from "@/lib/utils";
import { ProjectFileCodeView } from "./project-file-code-view";

const fileTreeStyle = {
  "--trees-search-bg-override": "var(--secondary)",
} as CSSProperties;

type ProjectFileTreeState = {
  fileTree: ProjectFileTreeSummary | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
};

type OpenFileState = {
  path: string;
  content: string | null;
  loading: boolean;
  error: string | null;
  sizeBytes: number | null;
};

export function ProjectFilesPanel({
  project,
  visible,
  expanded,
  onFileOpen,
}: {
  project: ProjectSummary | null;
  visible: boolean;
  expanded: boolean;
  onFileOpen?: () => void;
}) {
  const state = useProjectFileTree(project, { enabled: visible });
  const readyProject = project?.status === "ready";
  const [openFiles, setOpenFiles] = useState<OpenFileState[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const projectId = readyProject ? project.id : null;

  useEffect(() => {
    queueMicrotask(() => {
      setOpenFiles([]);
      setActivePath(null);
    });
  }, [projectId]);

  const openFile = useCallback(
    (path: string) => {
      if (!projectId) return;
      onFileOpen?.();
      setActivePath(path);
      setOpenFiles((current) => {
        if (current.some((file) => file.path === path)) return current;
        return [
          ...current,
          { path, content: null, loading: true, error: null, sizeBytes: null },
        ];
      });
      void loadProjectFile(projectId, path).then((result) => {
        setOpenFiles((current) =>
          current.map((file) =>
            file.path === path
              ? {
                  ...file,
                  content: result.content,
                  error: result.error,
                  loading: false,
                  sizeBytes: result.sizeBytes,
                }
              : file,
          ),
        );
      });
    },
    [onFileOpen, projectId],
  );

  const closeFile = useCallback((path: string) => {
    setOpenFiles((current) => {
      const index = current.findIndex((file) => file.path === path);
      if (index === -1) return current;
      const next = current.filter((file) => file.path !== path);
      setActivePath((active) => {
        if (active !== path) return active;
        return next[index]?.path ?? next[index - 1]?.path ?? null;
      });
      return next;
    });
  }, []);

  const activeFile = openFiles.find((file) => file.path === activePath) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!project ? (
        <ProjectFilesEmptyState message="Select an active project to browse files." />
      ) : !readyProject ? (
        <ProjectFilesEmptyState message="Project files are available after the workspace is ready." />
      ) : state.loading ? (
        <ProjectFilesEmptyState message="Loading project files..." loading />
      ) : state.fileTree && state.fileTree.paths.length > 0 ? (
        <div
          className={cn(
            "min-h-0 flex-1 overflow-hidden",
            expanded && openFiles.length > 0 ? "grid grid-cols-[minmax(240px,32%)_1fr]" : "flex",
          )}
        >
          <ProjectFileTree
            paths={state.fileTree.paths}
            gitStatus={state.fileTree.gitStatus}
            totalCount={state.fileTree.totalCount}
            truncated={state.fileTree.truncated}
            refreshing={state.refreshing}
            onRefresh={state.refresh}
            onFileOpen={openFile}
            selectedPath={activePath}
            className={cn(
              expanded && openFiles.length > 0
                ? "border-r border-border"
                : "flex-1",
            )}
          />
          {expanded && openFiles.length > 0 ? (
            <ProjectFileViewer
              files={openFiles}
              activePath={activePath}
              activeFile={activeFile}
              onSelect={setActivePath}
              onClose={closeFile}
            />
          ) : null}
        </div>
      ) : (
        <ProjectFilesEmptyState message="No files found in this project." />
      )}
      {state.error ? (
        <div className="border-t border-border px-3 py-2 text-[11px] text-destructive">
          {state.error}
        </div>
      ) : null}
    </div>
  );
}

function ProjectFileTree({
  paths,
  gitStatus,
  totalCount,
  truncated,
  refreshing,
  onRefresh,
  onFileOpen,
  selectedPath,
  className,
}: {
  paths: readonly string[];
  gitStatus: readonly GitStatusEntry[];
  totalCount: number;
  truncated: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onFileOpen: (path: string) => void;
  selectedPath: string | null;
  className?: string;
}) {
  const sortedPaths = useMemo(() => [...paths].sort(), [paths]);
  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    gitStatus,
    paths: sortedPaths,
    search: true,
    searchBlurBehavior: "retain",
    onSelectionChange: (selectedPaths) => {
      const path = selectedPaths.at(-1);
      if (!path || path.endsWith("/")) return;
      onFileOpen(path);
    },
  });
  const search = useFileTreeSearch(model);

  useEffect(() => {
    model.resetPaths(sortedPaths, { initialExpandedPaths: [] });
    model.closeSearch();
  }, [model, sortedPaths]);

  useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

  useEffect(() => {
    if (!selectedPath) return;
    model.getItem(selectedPath)?.select();
  }, [model, selectedPath]);

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
          {search.value
            ? `${search.matchingPaths.length.toLocaleString()} match${search.matchingPaths.length === 1 ? "" : "es"}`
            : `${totalCount.toLocaleString()} files`}
          {truncated ? ` · showing ${paths.length.toLocaleString()}` : ""}
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh file tree"
          title="Refresh file tree"
        >
          {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
        <FileTree
          model={model}
          className="anton-file-tree h-full overflow-hidden rounded-md border border-border bg-background/45 [--trees-search-bg-override:var(--secondary)]"
          style={fileTreeStyle}
          aria-label="Project file tree"
        />
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

function ProjectFileViewer({
  files,
  activePath,
  activeFile,
  onSelect,
  onClose,
}: {
  files: OpenFileState[];
  activePath: string | null;
  activeFile: OpenFileState | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col bg-background/25">
      <div className="border-b border-border px-2">
        <div className="flex h-10 min-w-0 items-center gap-1 overflow-x-auto py-1">
          {files.map((file) => (
            <div
              key={file.path}
              className={cn(
                "inline-flex h-7 min-w-28 max-w-56 shrink-0 items-center rounded text-xs font-semibold transition-colors",
                activePath === file.path
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
              role="group"
              aria-label={`${baseName(file.path)} tab`}
              title={file.path}
            >
              <button
                type="button"
                onClick={() => onClose(file.path)}
                className="group/close relative ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-background/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label={`Close ${file.path}`}
                title={`Close ${baseName(file.path)}`}
              >
                <FileCode2 className="size-3.5 transition-opacity group-hover/close:opacity-0 group-focus-visible/close:opacity-0" />
                <X className="absolute size-3.5 opacity-0 transition-opacity group-hover/close:opacity-100 group-focus-visible/close:opacity-100" />
              </button>
              <button
                type="button"
                onClick={() => onSelect(file.path)}
                className="min-w-0 rounded py-1 pl-0.5 pr-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-pressed={activePath === file.path}
              >
                <span className="block truncate">{baseName(file.path)}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
      {activeFile ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {activeFile.path}
            </span>
            {activeFile.sizeBytes !== null ? (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {formatBytes(activeFile.sizeBytes)}
              </span>
            ) : null}
          </div>
          {activeFile.loading ? (
            <ProjectFilesEmptyState message="Loading file..." loading />
          ) : activeFile.error ? (
            <ProjectFilesEmptyState message={activeFile.error} />
          ) : activeFile.content !== null ? (
            <ProjectFileCodeView
              key={`${activeFile.path}:${activeFile.content.length}`}
              path={activeFile.path}
              content={activeFile.content}
            />
          ) : (
            <ProjectFilesEmptyState message="No file content available." />
          )}
        </div>
      ) : (
        <ProjectFilesEmptyState message="Select a file to preview its contents." />
      )}
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

async function loadProjectFile(
  projectId: string,
  path: string,
): Promise<{
  content: string | null;
  error: string | null;
  sizeBytes: number | null;
}> {
  try {
    const data = await getJson<{ file: ProjectFileContentSummary }>(
      `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
    );
    return {
      content: data.file.content,
      error: null,
      sizeBytes: data.file.sizeBytes,
    };
  } catch (err) {
    return {
      content: null,
      error: errorMessage(err, "Failed to load file"),
      sizeBytes: null,
    };
  }
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kib = sizeBytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}
