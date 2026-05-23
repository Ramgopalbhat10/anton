"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from "@/components/shared/feedback-states";
import { cn } from "@/lib/utils";
import type { ProjectStatusSummary, ProjectSummary } from "@/src/lib/api-types";
import { notifyProjectGitChanged, useProjectStatus } from "@/components/features/projects/hooks";

export function ProjectStatusPanel({
  project,
}: {
  project: ProjectSummary | null;
}) {
  const { status, loading, error, refresh } = useProjectStatus(
    project?.status === "ready" ? project.id : null,
  );

  if (!project) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <EmptyState message="Select a ready project to view status." />
      </div>
    );
  }

  if (project.status !== "ready") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <EmptyState message={`Project is ${project.status}. Status is unavailable until ready.`} />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="border-b border-border px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border">
              <Activity className="size-3" />
              Project status
            </div>
            <h2 className="mt-2 text-sm font-semibold">{project.fullName}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Workspace root, git state, scripts, and last agent run.
            </p>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              notifyProjectGitChanged(project.id);
              void refresh();
            }}
            disabled={loading}
            aria-label="Refresh project status"
            title="Refresh project status"
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        </div>
        {error ? (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        ) : null}
      </section>

      {loading && !status ? (
        <div className="px-3 py-4">
          <LoadingState label="Loading project status..." />
        </div>
      ) : status ? (
        <div className="space-y-0">
          <StatusSection title="Overview">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Branch" value={status.git.branch ?? "—"} />
              <Metric label="Dirty" value={status.git.dirtyCount} />
              <Metric
                label="Package manager"
                value={status.packageManager ?? "none"}
              />
            </div>
          </StatusSection>

          <StatusSection title="Root path">
            <PathRow path={status.project.localPath} />
          </StatusSection>

          <StatusSection title="Git">
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap gap-2">
                {status.git.upstream ? (
                  <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
                    {status.git.upstream}
                  </span>
                ) : (
                  <span>No upstream configured</span>
                )}
                {status.git.ahead !== null && status.git.behind !== null ? (
                  <span>
                    {status.git.ahead} ahead · {status.git.behind} behind origin
                  </span>
                ) : null}
              </div>
              {status.dirtyFiles.length > 0 ? (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-background/35 p-2 font-mono text-[10px] ring-1 ring-border/70">
                  {status.dirtyFiles.map((file) => (
                    <li key={file} className="truncate">
                      {file}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Working tree clean</p>
              )}
            </div>
          </StatusSection>

          <StatusSection title="Scripts">
            {status.scripts.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {status.scripts.map((script) => (
                  <span
                    key={script}
                    className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                  >
                    {script}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No npm scripts detected</p>
            )}
          </StatusSection>

          <StatusSection title="Last run">
            {status.lastRun ? (
              <LastRunCard lastRun={status.lastRun} />
            ) : (
              <p className="text-xs text-muted-foreground">
                No agent runs recorded for this project yet.
              </p>
            )}
          </StatusSection>
        </div>
      ) : (
        <div className="px-3 py-4">
          <EmptyState message="Project status unavailable." />
        </div>
      )}
    </div>
  );
}

function StatusSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border px-3 py-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-background/45 px-2 py-1.5 ring-1 ring-border">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-xs font-semibold">{value}</div>
    </div>
  );
}

function PathRow({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 break-all rounded-md bg-background/35 px-2 py-1.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border/70">
        {path}
      </code>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Copy root path"
        title="Copy root path"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(path);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

function LastRunCard({
  lastRun,
}: {
  lastRun: NonNullable<ProjectStatusSummary["lastRun"]>;
}) {
  const statusMeta = runStatusMeta(lastRun.status);
  return (
    <div className="rounded-md bg-background/35 p-2.5 ring-1 ring-border/70">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
            statusMeta.className,
          )}
        >
          <statusMeta.Icon className="size-3" />
          {statusMeta.label}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {lastRun.model}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric
          label="Duration"
          value={
            lastRun.durationMs !== null
              ? `${Math.round(lastRun.durationMs / 1000)}s`
              : "—"
          }
        />
        <Metric label="Steps" value={lastRun.stepCount ?? "—"} />
        <Metric label="Tokens" value={lastRun.totalTokens ?? "—"} />
        <Metric
          label="Cost"
          value={
            lastRun.costUsd !== null ? `$${lastRun.costUsd.toFixed(4)}` : "—"
          }
        />
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        <Clock className="size-3" />
        {new Date(lastRun.startedAt).toLocaleString()}
        <Link
          href={`/s/${lastRun.sessionId}`}
          className="ml-auto inline-flex items-center gap-1 text-foreground hover:underline"
        >
          Open session
          <ExternalLink className="size-3" />
        </Link>
      </div>
    </div>
  );
}

function runStatusMeta(status: NonNullable<ProjectStatusSummary["lastRun"]>["status"]) {
  switch (status) {
    case "completed":
      return {
        Icon: CheckCircle2,
        label: "Completed",
        className: "text-emerald-400 ring-emerald-400/30 bg-emerald-400/10",
      };
    case "running":
      return {
        Icon: Clock,
        label: "Running",
        className: "text-amber-400 ring-amber-400/30 bg-amber-400/10",
      };
    case "aborted":
      return {
        Icon: XCircle,
        label: "Aborted",
        className: "text-muted-foreground ring-border bg-secondary",
      };
    case "error":
      return {
        Icon: XCircle,
        label: "Error",
        className: "text-destructive ring-destructive/30 bg-destructive/10",
      };
  }
}
