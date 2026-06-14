"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  Braces,
  FileCode,
  FileText,
  Image as FileImage,
  Music as FileAudio,
  Video as FileVideo,
  FolderTree,
  ImageOff,
  Loader2,
  Palette,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { GitStatusEntry } from "@pierre/trees";
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
} from "@pierre/trees/react";

import { useProjectFileTree } from "@/components/features/projects/hooks";
import type {
  ProjectFileContentSummary,
  ProjectSummary,
} from "@/src/lib/api-types";
import { errorMessage, getJson } from "@/src/lib/client-fetch";
import { cn } from "@/lib/utils";
import { ProjectFileCodeView } from "./project-file-code-view";

function countBadgeGitChanges(
  gitStatus: readonly Pick<GitStatusEntry, "status">[],
): number {
  return gitStatus.filter((entry) => entry.status !== "ignored").length;
}

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
  const readyProject = project?.status === "ready";
  const projectId = readyProject ? project.id : null;
  const state = useProjectFileTree(visible ? projectId : null);
  const [openFiles, setOpenFiles] = useState<OpenFileState[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

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
      ) : state.loading && !state.fileTree ? (
        <ProjectFilesEmptyState message="Loading project files..." loading />
      ) : state.fileTree && state.fileTree.paths.length > 0 ? (
        <div
          className={cn(
            "min-h-0 flex-1 overflow-hidden",
            expanded && openFiles.length > 0 ? "grid grid-cols-[minmax(240px,32%)_1fr]" : "flex",
          )}
        >
          <ProjectFileTree
            project={project}
            paths={state.fileTree.paths}
            gitStatus={state.fileTree.gitStatus}
            truncated={state.fileTree.truncated}
            refreshing={state.refreshing}
            onRefresh={() => void state.refresh()}
            onFileOpen={openFile}
            selectedPath={activePath}
            className={cn(
              expanded && openFiles.length > 0
                ? "border-r border-layout-border"
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
        <div className="border-t border-border px-2 py-2 text-[12px] text-destructive">
          {state.error}
        </div>
      ) : null}
    </div>
  );
}

function ProjectFileTree({
  project,
  paths,
  gitStatus,
  truncated,
  refreshing,
  onRefresh,
  onFileOpen,
  selectedPath,
  className,
}: {
  project: ProjectSummary | null;
  paths: readonly string[];
  gitStatus: readonly GitStatusEntry[];
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
    search: false,
    onSelectionChange: (selectedPaths) => {
      const path = selectedPaths.at(-1);
      if (!path || path.endsWith("/")) return;
      onFileOpen(path);
    },
  });
  const search = useFileTreeSearch(model);
  const badgeChangeCount = useMemo(
    () => countBadgeGitChanges(gitStatus),
    [gitStatus],
  );

  useLayoutEffect(() => {
    model.resetPaths(sortedPaths, { initialExpandedPaths: [] });
    model.closeSearch();
    model.setGitStatus(gitStatus);
  }, [model, sortedPaths, gitStatus]);

  useEffect(() => {
    if (!selectedPath) return;
    model.getItem(selectedPath)?.select();
  }, [model, selectedPath]);

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <div className="flex h-[41px] shrink-0 items-center justify-between gap-2 border-b border-layout-border pl-3.5 pr-3">
        <div className="min-w-0 flex-1 truncate font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          {search.value
            ? `${search.matchingPaths.length.toLocaleString()} match${search.matchingPaths.length === 1 ? "" : "es"}`
            : project?.localPath || "Project"}
          {!search.value && badgeChangeCount > 0
            ? ` · ${badgeChangeCount.toLocaleString()} changed`
            : ""}
          {truncated ? ` · showing ${paths.length.toLocaleString()}` : ""}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh file tree"
          title="Refresh file tree"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-(--text-tertiary) transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
        >
          {refreshing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
        </button>
      </div>
      <div className="shrink-0 px-3 pb-1.5 pt-2.5">
        <div className="flex items-center gap-[7px] rounded-md border border-border bg-input px-2.5 py-[7px] transition-colors focus-within:border-ring/60">
          <Search className="size-3 shrink-0 text-(--text-tertiary)" />
          <input
            type="text"
            value={search.value}
            onChange={(event) => {
              const value = event.target.value;
              search.setValue(value.length > 0 ? value : null);
            }}
            placeholder="Search files…"
            aria-label="Search files"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12px] leading-none text-foreground outline-none placeholder:text-(--text-tertiary)"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden pb-3 pt-1">
        <FileTree
          model={model}
          className="anton-file-tree h-full overflow-hidden"
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

function isUnsupportedFileError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not valid utf-8") ||
    normalized.includes("binary file content")
  );
}

function ProjectFileUnsupportedState({ message }: { message: string }) {
  const title = message.charAt(0).toUpperCase() + message.slice(1);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 bg-background px-6 py-14 text-center">
      <ImageOff className="size-[22px] text-(--text-tertiary)" />
      <span className="text-[12.5px] font-medium text-muted-foreground">
        {title}
      </span>
      <span className="text-[11.5px] text-(--text-tertiary)">
        Binary files can&apos;t be previewed in the editor.
      </span>
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
    <div className="flex min-h-0 min-w-0 flex-col">
      <div
        className="flex h-[41px] shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-layout-border px-2.5 scrollbar-hide"
        onWheel={(e) => {
          if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        }}
      >
        {files.map((file) => {
          const isActive = activePath === file.path;
          return (
            <div
              key={file.path}
              className={cn(
                "inline-flex h-[26px] min-w-0 max-w-44 shrink-0 items-center gap-1.5 rounded-md border px-[9px] font-mono text-[10.5px] leading-none transition-colors",
                isActive
                  ? "border-border bg-secondary text-foreground"
                  : "border-transparent text-(--text-tertiary) hover:bg-muted hover:text-muted-foreground",
              )}
              role="group"
              aria-label={`${baseName(file.path)} tab`}
              title={file.path}
            >
              <button
                type="button"
                onClick={() => onClose(file.path)}
                className="group/close relative inline-flex size-[15px] shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-background/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label={`Close ${file.path}`}
                title={`Close ${baseName(file.path)}`}
              >
                <FileIcon
                  path={file.path}
                  className="size-[11px] transition-opacity group-hover/close:opacity-0 group-focus-visible/close:opacity-0"
                />
                <X className="absolute size-[11px] text-(--text-tertiary) opacity-0 transition-opacity group-hover/close:opacity-100 group-focus-visible/close:opacity-100" />
              </button>
              <button
                type="button"
                onClick={() => onSelect(file.path)}
                className="min-w-0 rounded-sm pr-0.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-pressed={isActive}
              >
                <span className="block truncate">{baseName(file.path)}</span>
              </button>
            </div>
          );
        })}
      </div>
      {activeFile ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-2.5 border-b border-layout-border px-3.5 py-2">
            <div className="flex min-w-0 items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
              {activeFile.path.split("/").filter(Boolean).map((segment, index, array) => (
                <span key={index} className="flex items-center gap-1">
                  <span className="truncate transition-colors hover:text-foreground">{segment}</span>
                  {index < array.length - 1 && <span className="shrink-0 text-(--text-tertiary)">/</span>}
                </span>
              ))}
            </div>
            {activeFile.sizeBytes !== null ? (
              <span className="shrink-0 font-mono text-[10.5px] text-(--text-tertiary)">
                {formatBytes(activeFile.sizeBytes)}
              </span>
            ) : null}
          </div>
          {activeFile.loading ? (
            <ProjectFilesEmptyState message="Loading file..." loading />
          ) : activeFile.error ? (
            isUnsupportedFileError(activeFile.error) ? (
              <ProjectFileUnsupportedState message={activeFile.error} />
            ) : (
              <ProjectFilesEmptyState message={activeFile.error} />
            )
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



// File-type icon hues mirror the colored icons in design/mockups.pen (W3nOF).
function FileIcon({ path, className }: { path: string; className?: string }) {
  const extension = path.split(".").pop()?.toLowerCase() || "";

  if (["tsx", "jsx"].includes(extension)) {
    return <FileCode className={className} style={{ color: "#38BDF8" }} />;
  }
  if (["ts", "js", "mjs", "cjs", "py", "rs", "go", "rb", "java", "c", "cpp", "vue", "html", "sh"].includes(extension)) {
    return <FileCode className={className} style={{ color: "#5EA0EF" }} />;
  }
  if (["css", "scss", "sass", "less"].includes(extension)) {
    return <Palette className={className} style={{ color: "#A78BFA" }} />;
  }
  if (["json", "yaml", "yml", "toml"].includes(extension)) {
    return <Braces className={className} style={{ color: "#FACC15" }} />;
  }
  if (extension === "svg") {
    return <FileImage className={className} style={{ color: "var(--primary)" }} />;
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "ico", "avif"].includes(extension)) {
    return <FileImage className={className} style={{ color: "#F472B6" }} />;
  }
  if (["mp3", "wav", "ogg", "flac"].includes(extension)) {
    return <FileAudio className={className} style={{ color: "var(--text-tertiary)" }} />;
  }
  if (["mp4", "webm", "mov", "avi"].includes(extension)) {
    return <FileVideo className={className} style={{ color: "var(--text-tertiary)" }} />;
  }
  if (["md", "markdown", "mdx"].includes(extension)) {
    return <FileText className={className} style={{ color: "#7AA2F7" }} />;
  }

  return <FileText className={className} style={{ color: "var(--text-tertiary)" }} />;
}
