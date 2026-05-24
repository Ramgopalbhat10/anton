"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
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
import { BackgroundCommandsPanel } from "@/components/features/projects/background-commands-panel";
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
      <section className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-medium">{project.fullName}</h2>
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
          <div className="mt-2">
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
            <div className="space-y-1.5 text-[11px] text-muted-foreground">
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="font-mono text-foreground">
                  {status.git.branch ?? "—"}
                </span>
                <span>·</span>
                <span>{status.git.dirtyCount} dirty</span>
                <span>·</span>
                <span>{status.packageManager ?? "no pm"}</span>
              </p>
              <PathRow path={status.project.localPath} />
            </div>
          </StatusSection>

          <BackgroundCommandsPanel projectId={project.id} status={status} />

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
    <section className="border-b border-border px-3 py-2">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function PathRow({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
        {path}
      </code>
      <Button
        type="button"
        size="icon-xs"
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
        {copied ? <CheckCircle2 className="size-3" /> : <Copy className="size-3" />}
      </Button>
    </div>
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

function LastRunCard({
  lastRun,
}: {
  lastRun: NonNullable<ProjectStatusSummary["lastRun"]>;
}) {
  const statusMeta = runStatusMeta(lastRun.status);
  return (
    <>
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
    </>
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
