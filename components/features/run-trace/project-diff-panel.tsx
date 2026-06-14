"use client";

import { useEffect, useState } from "react";
import { GitBranch, RefreshCw } from "lucide-react";

import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from "@/components/shared/feedback-states";
import { cn } from "@/lib/utils";
import type {
  ProjectGitStatusSummary,
  ProjectLocalDiffSummary,
  ProjectSummary,
} from "@/src/lib/api-types";
import { getJson } from "@/src/lib/client-fetch";
import {
  notifyProjectGitChanged,
  PROJECT_GIT_CHANGED_EVENT,
} from "@/components/features/projects/hooks";
import { LocalChangesView } from "./pr-sidebar";

export function ProjectDiffPanel({
  project,
  visible = true,
}: {
  project: ProjectSummary | null;
  visible?: boolean;
}) {
  const [gitStatus, setGitStatus] = useState<ProjectGitStatusSummary | null>(null);
  const [localDiff, setLocalDiff] = useState<ProjectLocalDiffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectId = project?.status === "ready" ? project.id : null;

  useEffect(() => {
    if (!visible || !projectId) {
      queueMicrotask(() => {
        setGitStatus(null);
        setLocalDiff(null);
        setError(null);
        setLoading(false);
      });
      return;
    }

    let cancelled = false;
    const load = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      try {
        const statusData = await getJson<{ status: ProjectGitStatusSummary }>(
          `/api/projects/${projectId}/git/status`,
        );
        if (cancelled) return;
        setGitStatus(statusData.status);

        if (statusData.status.dirtyCount > 0) {
          const diffData = await getJson<{ diff: ProjectLocalDiffSummary }>(
            `/api/projects/${projectId}/git/diff`,
          );
          if (cancelled) return;
          setLocalDiff(diffData.diff);
          setError(null);
        } else {
          setLocalDiff(null);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load diff");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load(true);
    const onProjectGitChanged = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        typeof event.detail === "string" &&
        event.detail === projectId
      ) {
        void load(false);
      }
    };
    window.addEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);
    };
  }, [projectId, visible]);

  if (!project) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <EmptyState message="Select a ready project to view changes." />
      </div>
    );
  }

  if (project.status !== "ready") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <EmptyState message={`Project is ${project.status}. Diff is unavailable until ready.`} />
      </div>
    );
  }

  const files = localDiff?.files ?? [];
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-layout-border px-3.5 py-[9px]">
        <div className="flex min-w-0 items-center gap-2 font-mono text-[10.5px]">
          {gitStatus ? (
            <>
              <span className="inline-flex min-w-0 items-center gap-[5px] rounded-[5px] border border-border bg-input px-2 py-0.5">
                <GitBranch className="size-[11px] shrink-0 text-(--text-tertiary)" />
                <span className="truncate font-semibold text-foreground">
                  {gitStatus.branch ?? "detached"}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0",
                  gitStatus.dirtyCount > 0
                    ? "text-primary"
                    : "text-(--text-tertiary)",
                )}
              >
                {gitStatus.dirtyCount} dirty
              </span>
              {gitStatus.ahead !== null && gitStatus.behind !== null ? (
                <>
                  <span className="shrink-0 text-(--text-tertiary)">·</span>
                  <span
                    className={cn(
                      "shrink-0",
                      gitStatus.ahead > 0
                        ? "text-success"
                        : "text-(--text-tertiary)",
                    )}
                  >
                    {gitStatus.ahead}↑
                  </span>
                  <span className="shrink-0 text-(--text-tertiary)">
                    {gitStatus.behind}↓
                  </span>
                </>
              ) : null}
            </>
          ) : (
            <span className="text-(--text-tertiary)">Loading git state…</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            notifyProjectGitChanged(project.id);
          }}
          disabled={loading}
          aria-label="Refresh diff"
          title="Refresh diff"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-(--text-tertiary) transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3", loading && "animate-spin")} />
        </button>
      </div>

      {loading && files.length === 0 ? (
        <div className="px-3.5 py-4">
          <LoadingState label="Loading changes..." />
        </div>
      ) : error ? (
        <div className="px-3.5 pt-3">
          <ErrorBanner message={error} />
        </div>
      ) : files.length > 0 ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="flex shrink-0 items-center gap-2 px-3.5 pt-3 font-mono text-[11px]">
            <span className="font-sans text-[11.5px] text-(--text-tertiary)">
              {files.length} file{files.length === 1 ? "" : "s"} changed
            </span>
            <span className="font-semibold tabular-nums text-success">
              +{additions}
            </span>
            <span className="font-semibold tabular-nums text-destructive">
              -{deletions}
            </span>
          </div>
          <LocalChangesView files={files} />
        </div>
      ) : (
        <div className="px-3.5 pt-3">
          <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-6 py-9 text-center">
            <GitBranch className="size-5 text-(--text-tertiary)" />
            <span className="text-[12.5px] font-medium text-muted-foreground">
              Working tree clean
            </span>
            <span className="text-[11.5px] text-(--text-tertiary)">
              Uncommitted changes in this project will show up here.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
