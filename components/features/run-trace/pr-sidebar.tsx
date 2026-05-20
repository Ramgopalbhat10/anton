"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  GitCommit,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  ProjectGitStatusSummary,
  ProjectPullRequestFileSummary,
  ProjectPullRequestSummary,
} from "@/src/lib/api-types";
import { PatchDiffView } from "./diff-view";

export function PullRequestPanel({
  pullRequest,
  gitStatus,
  loading,
  error,
  onRefresh,
}: {
  pullRequest: ProjectPullRequestSummary;
  gitStatus: ProjectGitStatusSummary | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const selected =
    pullRequest.files.find((file) => file.filename === selectedFile) ??
    pullRequest.files[0] ??
    null;

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <section className="border-b border-border px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <StateBadge pullRequest={pullRequest} />
              <span className="truncate text-muted-foreground">
                PR #{pullRequest.number}
              </span>
            </div>
            <h2 className="mt-1 line-clamp-2 text-sm font-semibold leading-5">
              {pullRequest.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              <span className="rounded bg-secondary px-1.5 py-0.5">
                {pullRequest.baseBranch}
              </span>
              <span>&lt;-</span>
              <span className="rounded bg-secondary px-1.5 py-0.5">
                {pullRequest.headBranch}
              </span>
              {gitStatus?.dirtyCount ? (
                <span className="text-amber-500">
                  {gitStatus.dirtyCount} dirty
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refresh pull request"
              title="Refresh pull request"
            >
              <RefreshCw className={cn(loading && "animate-spin")} />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              asChild
              aria-label="Open pull request on GitHub"
              title="Open pull request on GitHub"
            >
              <a href={pullRequest.htmlUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
              </a>
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <Metric label="Files" value={pullRequest.changedFiles} />
          <Metric label="Add" value={`+${pullRequest.additions}`} tone="add" />
          <Metric label="Del" value={`-${pullRequest.deletions}`} tone="delete" />
        </div>
        {error ? (
          <div className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            {error}
          </div>
        ) : null}
      </section>

      <Tabs defaultValue="changes" className="min-w-0 gap-0">
        <div className="border-b border-border px-2 py-1.5">
          <TabsList className="gap-1">
            <TabsTrigger value="changes" className="h-6 px-2 py-0 text-[11px]">
              Changes
            </TabsTrigger>
            <TabsTrigger value="discussion" className="h-6 px-2 py-0 text-[11px]">
              Discussion
            </TabsTrigger>
            <TabsTrigger value="commits" className="h-6 px-2 py-0 text-[11px]">
              Commits
            </TabsTrigger>
            <TabsTrigger value="checks" className="h-6 px-2 py-0 text-[11px]">
              Checks
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="changes" className="m-0 min-w-0">
          <ChangesView
            files={pullRequest.files}
            selected={selected}
            onSelect={setSelectedFile}
          />
        </TabsContent>
        <TabsContent value="discussion" className="m-0">
          <SummaryList
            rows={[
              {
                icon: MessageSquare,
                label: "Comments",
                value: pullRequest.comments,
              },
              {
                icon: FileText,
                label: "Review comments",
                value: pullRequest.reviewComments,
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="commits" className="m-0">
          <SummaryList
            rows={[
              { icon: GitCommit, label: "Commits", value: pullRequest.commits },
              {
                icon: GitCommit,
                label: "Head",
                value: pullRequest.headSha.slice(0, 7),
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="checks" className="m-0">
          <ChecksView pullRequest={pullRequest} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function PullRequestEmptyPanel({
  gitStatus,
  localFiles,
  loading,
  creating,
  error,
  onRefresh,
  onCreatePullRequest,
}: {
  gitStatus: ProjectGitStatusSummary | null;
  localFiles: ProjectPullRequestFileSummary[];
  loading: boolean;
  creating: boolean;
  error: string | null;
  onRefresh: () => void;
  onCreatePullRequest: () => void;
}) {
  const createReady = canCreatePullRequest(gitStatus);
  const canShowCreateAction = Boolean(gitStatus?.branch && !gitStatus.isDefaultBranch);
  const createBlocker =
    gitStatus && canShowCreateAction && !createReady
      ? pullRequestCreateBlocker(gitStatus)
      : null;
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const selected =
    localFiles.find((file) => file.filename === selectedFile) ??
    localFiles[0] ??
    null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="border-b border-border px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border">
              <GitPullRequest className="size-3" />
              No PR
            </div>
            <h2 className="mt-2 text-sm font-semibold">Pull request</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {emptyPullRequestMessage(gitStatus)}
            </p>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh pull request"
            title="Refresh pull request"
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        </div>
        {gitStatus ? (
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <Metric label="Branch" value={gitStatus.branch ?? "detached"} />
            <Metric label="Dirty" value={gitStatus.dirtyCount} />
          </div>
        ) : null}
        {canShowCreateAction ? (
          <Button
            type="button"
            size="sm"
            className="mt-3"
            onClick={onCreatePullRequest}
            disabled={!createReady || loading || creating}
            title={createBlocker ?? "Create pull request"}
          >
            {creating ? (
              <RefreshCw className="animate-spin" />
            ) : (
              <GitPullRequest />
            )}
            Create PR
          </Button>
        ) : null}
        {createBlocker ? (
          <p className="mt-3 text-[11px] text-muted-foreground">
            {createBlocker}
          </p>
        ) : null}
        {error ? (
          <div className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            {error}
          </div>
        ) : null}
      </section>
      {localFiles.length > 0 ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="border-b border-border px-3 py-2 text-[11px] font-medium text-muted-foreground">
            Local changes
          </div>
          <ChangesView
            files={localFiles}
            selected={selected}
            onSelect={setSelectedFile}
          />
        </div>
      ) : null}
    </div>
  );
}

function canCreatePullRequest(gitStatus: ProjectGitStatusSummary | null): boolean {
  return Boolean(
    gitStatus?.branch &&
      !gitStatus.isDefaultBranch &&
      gitStatus.upstream?.startsWith("origin/") &&
      gitStatus.upstreamAhead === 0 &&
      gitStatus.dirtyCount === 0,
  );
}

function pullRequestCreateBlocker(
  gitStatus: ProjectGitStatusSummary,
): string {
  if (gitStatus.dirtyCount > 0) {
    return "Commit or discard local changes before creating a PR.";
  }
  if (!gitStatus.upstream?.startsWith("origin/")) {
    return "Push this branch to origin before creating a PR.";
  }
  if (gitStatus.upstreamAhead !== null && gitStatus.upstreamAhead > 0) {
    return "Push local commits before creating a PR.";
  }
  return "Create a PR after the branch is available on origin.";
}

function emptyPullRequestMessage(gitStatus: ProjectGitStatusSummary | null): string {
  if (!gitStatus) return "Loading current branch status.";
  if (!gitStatus.branch) return "The project is not on a named local branch.";
  if (gitStatus.isDefaultBranch) {
    return `The current branch is ${gitStatus.defaultBranch}; PR lookup starts on non-default branches.`;
  }
  return `No GitHub pull request matches ${gitStatus.branch}.`;
}

function ChangesView({
  files,
  selected,
  onSelect,
}: {
  files: ProjectPullRequestFileSummary[];
  selected: ProjectPullRequestFileSummary | null;
  onSelect: (filename: string) => void;
}) {
  if (files.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-xs text-muted-foreground">
        No changed files reported.
      </div>
    );
  }

  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[auto_1fr] overflow-hidden">
      <ol className="max-h-56 min-w-0 overflow-y-auto border-b border-border px-2 py-2">
        {files.map((file) => (
          <li key={file.filename}>
            <button
              type="button"
              onClick={() => onSelect(file.filename)}
              className={cn(
                "grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                selected?.filename === file.filename
                  ? "bg-accent/70"
                  : "hover:bg-accent/40",
              )}
            >
              <FileStatusBadge status={file.status} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{file.filename}</span>
                {file.previousFilename ? (
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    from {file.previousFilename}
                  </span>
                ) : null}
              </span>
              <span className="font-mono text-[10px] tabular-nums">
                <span className="text-emerald-500">+{file.additions}</span>
                <span className="mx-1 text-muted-foreground/50">/</span>
                <span className="text-destructive">-{file.deletions}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {selected ? <PatchView file={selected} /> : null}
    </div>
  );
}

function FileStatusBadge({ status }: { status: string }) {
  const meta = fileStatusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex size-4 items-center justify-center rounded-sm font-mono text-[10px] font-semibold ring-1",
        meta.className,
      )}
      title={meta.label}
      aria-label={meta.label}
    >
      {meta.char}
    </span>
  );
}

function fileStatusMeta(status: string): {
  char: string;
  label: string;
  className: string;
} {
  switch (status) {
    case "added":
      return {
        char: "A",
        label: "Added",
        className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
      };
    case "modified":
    case "changed":
      return {
        char: "M",
        label: "Modified",
        className: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
      };
    case "removed":
    case "deleted":
      return {
        char: "D",
        label: "Deleted",
        className: "bg-destructive/15 text-red-300 ring-destructive/30",
      };
    case "renamed":
      return {
        char: "R",
        label: "Renamed",
        className: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
      };
    default:
      return {
        char: status.slice(0, 1).toUpperCase() || "?",
        label: status || "Unknown",
        className: "bg-secondary text-muted-foreground ring-border",
      };
  }
}

function PatchView({ file }: { file: ProjectPullRequestFileSummary }) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden p-2">
      <PatchDiffView
        patch={file.patch}
        filename={file.filename}
        previousFilename={file.previousFilename}
        status={file.status}
      />
    </div>
  );
}

function ChecksView({
  pullRequest,
}: {
  pullRequest: ProjectPullRequestSummary;
}) {
  const meta = checkStateMeta(pullRequest.checks.state);
  if (pullRequest.checks.total === 0) {
    return (
      <div className="px-3 py-8 text-center text-xs text-muted-foreground">
        No check runs reported.
      </div>
    );
  }

  return (
    <div className="px-3 py-3">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <meta.Icon className={cn("size-3.5", meta.className)} />
        <span className="font-medium">{meta.label}</span>
        <span className="text-muted-foreground">
          {pullRequest.checks.passed} passed / {pullRequest.checks.pending} pending /{" "}
          {pullRequest.checks.failed} failed
        </span>
      </div>
      <ol className="grid gap-1.5">
        {pullRequest.checks.runs.map((run) => {
          const runMeta = runStateMeta(run);
          return (
            <li key={`${run.name}:${run.htmlUrl ?? ""}`}>
              <a
                href={run.htmlUrl ?? pullRequest.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="grid grid-cols-[0.875rem_1fr] gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent/50"
              >
                <runMeta.Icon className={cn("mt-0.5 size-3.5", runMeta.className)} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{run.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {run.conclusion ?? run.status}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SummaryList({
  rows,
}: {
  rows: { icon: typeof MessageSquare; label: string; value: string | number }[];
}) {
  return (
    <div className="px-3 py-3">
      <dl className="grid gap-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[0.875rem_1fr_auto] items-center gap-2 rounded-md bg-background/45 px-2 py-2 text-xs ring-1 ring-border"
          >
            <row.icon className="size-3.5 text-muted-foreground" />
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="font-mono text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StateBadge({
  pullRequest,
}: {
  pullRequest: ProjectPullRequestSummary;
}) {
  const label = pullRequest.merged
    ? "Merged"
    : pullRequest.state === "open"
      ? "Open"
      : "Closed";
  const className = pullRequest.merged
    ? "bg-purple-500/15 text-purple-300 ring-purple-500/30"
    : pullRequest.state === "open"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : "bg-secondary text-muted-foreground ring-border";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] ring-1",
        className,
      )}
    >
      <GitPullRequest className="size-3" />
      {label}
    </span>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "add" | "delete";
}) {
  return (
    <div className="rounded-md bg-background/45 px-2 py-1.5 ring-1 ring-border">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-mono text-xs font-semibold",
          tone === "add" && "text-emerald-400",
          tone === "delete" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function checkStateMeta(state: ProjectPullRequestSummary["checks"]["state"]) {
  switch (state) {
    case "success":
      return { Icon: CheckCircle2, label: "Checks passed", className: "text-emerald-400" };
    case "failure":
      return { Icon: XCircle, label: "Checks failed", className: "text-destructive" };
    case "error":
      return { Icon: AlertCircle, label: "Checks errored", className: "text-destructive" };
    case "pending":
      return { Icon: Clock, label: "Checks pending", className: "text-amber-400" };
    case "unknown":
      return { Icon: AlertCircle, label: "Checks unknown", className: "text-muted-foreground" };
  }
}

function runStateMeta(
  run: ProjectPullRequestSummary["checks"]["runs"][number],
) {
  if (run.status !== "completed") {
    return { Icon: Clock, className: "text-amber-400" };
  }
  if (["success", "neutral", "skipped"].includes(run.conclusion ?? "")) {
    return { Icon: CheckCircle2, className: "text-emerald-400" };
  }
  return { Icon: XCircle, className: "text-destructive" };
}
