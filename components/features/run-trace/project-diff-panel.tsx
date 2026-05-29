"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <section className="shrink-0 border-b border-layout-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 text-[11px] text-muted-foreground">
            {gitStatus ? (
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="font-mono text-foreground">
                  {gitStatus.branch ?? "detached"}
                </span>
                <span>·</span>
                <span>{gitStatus.dirtyCount} dirty</span>
                {gitStatus.ahead !== null && gitStatus.behind !== null ? (
                  <>
                    <span>·</span>
                    <span>
                      {gitStatus.ahead}↑ {gitStatus.behind}↓
                    </span>
                  </>
                ) : null}
              </p>
            ) : (
              <p>Loading git state…</p>
            )}
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              notifyProjectGitChanged(project.id);
            }}
            disabled={loading}
            aria-label="Refresh diff"
            title="Refresh diff"
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        </div>
        {error ? (
          <div className="mt-2">
            <ErrorBanner message={error} />
          </div>
        ) : null}
      </section>

      {loading && files.length === 0 ? (
        <div className="px-3 py-4">
          <LoadingState label="Loading changes..." />
        </div>
      ) : files.length > 0 ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <LocalChangesView files={files} />
        </div>
      ) : (
        <div className="px-3 py-4">
          <EmptyState message="Working tree clean." />
        </div>
      )}
    </div>
  );
}
