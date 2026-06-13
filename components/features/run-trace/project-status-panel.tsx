"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  GitBranch,
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
import { ProjectRunDetails } from "@/components/features/run-trace/project-run-details";
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
  const [detailsRefreshToken, setDetailsRefreshToken] = useState(0);

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
      <section className="border-b border-layout-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold">{project.fullName}</h2>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              notifyProjectGitChanged(project.id);
              void refresh().then(() => {
                setDetailsRefreshToken((value) => value + 1);
              });
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
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                <span className="font-mono text-xs font-semibold text-foreground">
                  {status.git.branch ?? "—"}
                </span>
                <span className="text-[11.5px] text-muted-foreground/65">
                  · {status.git.dirtyCount} dirty · {status.packageManager ?? "no pm"}
                </span>
              </div>
              <PathRow path={status.project.localPath} />
            </div>
          </StatusSection>

          <BackgroundCommandsPanel projectId={project.id} status={status} />

          <StatusSection title="Last project run">
            {status.lastRun ? (
              <LastRunCard
                projectId={project.id}
                lastRun={status.lastRun}
                detailsRefreshToken={detailsRefreshToken}
              />
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
    <section className="border-b border-layout-border px-3 py-2.5">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/65">
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
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-(--accent-muted)">
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


function LastRunCard({
  projectId,
  lastRun,
  detailsRefreshToken,
}: {
  projectId: string;
  lastRun: NonNullable<ProjectStatusSummary["lastRun"]>;
  detailsRefreshToken: number;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsEverOpened, setDetailsEverOpened] = useState(false);
  const statusMeta = runStatusMeta(lastRun);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-medium",
            statusMeta.className,
          )}
        >
          <statusMeta.Icon className="size-[11px]" />
          {statusMeta.label}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground/65">
          {lastRun.model}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <RunStatTile
          label="Duration"
          value={
            lastRun.durationMs !== null
              ? `${Math.round(lastRun.durationMs / 1000)}s`
              : "—"
          }
        />
        <RunStatTile label="Steps" value={lastRun.stepCount ?? "—"} />
        <RunStatTile label="Tokens" value={lastRun.totalTokens ?? "—"} />
        <RunStatTile
          label="Cost"
          value={
            lastRun.costUsd !== null ? `$${lastRun.costUsd.toFixed(4)}` : "—"
          }
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground/65">
        <Clock className="size-[11px] shrink-0" />
        <span>{new Date(lastRun.startedAt).toLocaleString()}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground",
              detailsOpen && "bg-secondary/40 text-foreground",
            )}
            onClick={() => {
              setDetailsEverOpened(true);
              setDetailsOpen((open) => !open);
            }}
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? (
              <ChevronDown className="size-3 shrink-0" />
            ) : (
              <ChevronRight className="size-3 shrink-0" />
            )}
            Details
          </button>
          <Link
            href={`/s/${lastRun.sessionId}`}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-primary transition-colors hover:bg-primary/10"
          >
            Open session
            <ExternalLink className="size-2.5" />
          </Link>
        </div>
      </div>
      {detailsEverOpened ? (
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
            detailsOpen
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <ProjectRunDetails
              key={`${lastRun.runId}:${detailsRefreshToken}`}
              projectId={projectId}
              runId={lastRun.runId}
              refreshToken={detailsRefreshToken}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function RunStatTile({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-2.5 py-2">
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/65">
        {label}
      </span>
      <span className="truncate font-mono text-sm font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function runStatusMeta(lastRun: NonNullable<ProjectStatusSummary["lastRun"]>) {
  switch (lastRun.status) {
    case "completed":
      return {
        Icon: CheckCircle2,
        label: "Completed",
        className: "text-success ring-success/30 bg-success/10",
      };
    case "running":
      return {
        Icon: Clock,
        label: "Running",
        className: "text-warning ring-warning/30 bg-warning/10",
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
