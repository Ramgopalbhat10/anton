"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileCode,
  FileText,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Search,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  ProjectGitStatusSummary,
  ProjectPullRequestCommitSummary,
  ProjectPullRequestDiscussionItem,
  ProjectPullRequestFileSummary,
  ProjectPullRequestListItem,
  ProjectPullRequestSummary,
  ProjectPullRequestCheckSummary,
  ProjectSummary,
} from "@/src/lib/api-types";
import { errorMessage, getJson } from "@/src/lib/client-fetch";
import { Markdown } from "@/components/features/chat/markdown";
import {
  PopupSortSelect,
  type PopupSortOption,
} from "@/components/shared/popup-sort-select";
import { PatchDiffView } from "./diff-view";

type PrTabId = "changes" | "description" | "discussion" | "commits" | "checks";

const PR_META_SECTION = "flex flex-col gap-[9px] px-3.5 py-3";
const PR_TABS_ROW = "flex shrink-0 items-center gap-1 px-3.5 pb-2.5";
const PR_CONTENT_SCROLL = "min-h-0 flex-1 overflow-y-auto border-t border-layout-border";
const PR_BODY_PAD = "px-3.5 pt-3 pb-3.5";

const PR_ICON_BUTTON =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-(--text-tertiary) transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60";

const PR_MARKDOWN_CLASSNAME =
  "min-w-0 space-y-2.5 text-[12.5px] leading-[1.55] text-muted-foreground wrap-break-word [&_a]:text-primary [&_a]:no-underline hover:[&_a]:underline [&_code]:rounded [&_code]:bg-input [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-muted-foreground [&_h1]:text-[12.5px] [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:text-foreground [&_h2]:text-[12.5px] [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:text-foreground [&_h3]:text-[12.5px] [&_h3]:font-bold [&_h3]:leading-tight [&_h3]:text-foreground [&_li]:leading-[1.55] [&_ol]:space-y-2 [&_p]:leading-[1.55] [&_strong]:text-foreground [&_table]:w-full [&_table]:border-separate [&_table]:border-spacing-0 [&_table]:overflow-hidden [&_table]:rounded-md [&_table]:border [&_table]:border-border [&_table]:text-[11.5px] [&_th]:border-b [&_th]:border-layout-border [&_th]:bg-input [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-[10.5px] [&_th]:font-semibold [&_th]:text-(--text-tertiary) [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_tbody_tr+tr_td]:border-t [&_tbody_tr+tr_td]:border-layout-border [&_ul]:space-y-2";

export function PullRequestPanel({
  pullRequest,
  loading,
  error,
  project,
  projectId,
  onRefresh,
  onSelectPullRequest,
}: {
  pullRequest: ProjectPullRequestSummary;
  gitStatus: ProjectGitStatusSummary | null;
  loading: boolean;
  error: string | null;
  project: ProjectSummary | null;
  projectId: string | null;
  onRefresh: () => void;
  onSelectPullRequest: (number: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<PrTabId>("changes");

  const tabs: { id: PrTabId; label: string; count?: number }[] = [
    { id: "changes", label: "Changes" },
    { id: "description", label: "Description" },
    { id: "discussion", label: "Discussion", count: pullRequest.discussion.length },
    { id: "commits", label: "Commits", count: pullRequest.commitItems.length },
    { id: "checks", label: "Checks" },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={PR_META_SECTION}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <StateBadge pullRequest={pullRequest} />
            <PullRequestSelector
              project={project}
              pullRequest={pullRequest}
              onSelect={onSelectPullRequest}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              className={PR_ICON_BUTTON}
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refresh pull request"
              title="Refresh pull request"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </button>
            <a
              href={pullRequest.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className={PR_ICON_BUTTON}
              aria-label="Open pull request on GitHub"
              title="Open pull request on GitHub"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>

        <h2 className="line-clamp-2 text-[14.5px] font-semibold leading-[1.4] text-foreground">
          {pullRequest.title}
        </h2>

        <div className="flex flex-wrap items-center gap-x-[7px] gap-y-1.5">
          <BranchChip label={pullRequest.baseBranch} />
          <ArrowLeft className="size-3.5 shrink-0 text-(--text-tertiary)" />
          <BranchChip label={pullRequest.headBranch} />
          <span className="text-[11.5px] text-(--text-tertiary)">
            {pullRequest.changedFiles} files
          </span>
          <span className="font-mono text-[12px] font-semibold tabular-nums text-success">
            +{pullRequest.additions}
          </span>
          <span className="font-mono text-[12px] font-semibold tabular-nums text-destructive">
            -{pullRequest.deletions}
          </span>
        </div>

        {error ? (
          <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            {error}
          </div>
        ) : null}
      </div>

      <div
        role="tablist"
        aria-label="Pull request sections"
        className={PR_TABS_ROW}
      >
        {tabs.map((tab) => (
          <PrTabButton
            key={tab.id}
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.count !== undefined ? `${tab.label} ${tab.count}` : tab.label}
          </PrTabButton>
        ))}
      </div>

      <div className={PR_CONTENT_SCROLL}>
        {activeTab === "changes" ? (
          <LocalChangesView files={pullRequest.files} />
        ) : activeTab === "description" ? (
          <DescriptionView description={pullRequest.description} />
        ) : activeTab === "discussion" ? (
          <DiscussionView items={pullRequest.discussion} />
        ) : activeTab === "commits" ? (
          <CommitsView commits={pullRequest.commitItems} />
        ) : (
          <ChecksView
            pullRequest={pullRequest}
            projectId={projectId}
            onRefresh={onRefresh}
          />
        )}
      </div>
    </div>
  );
}

function PrTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-[26px] items-center rounded-lg px-3 text-[12.5px] leading-none whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "border border-border bg-secondary font-semibold text-foreground"
          : "border border-transparent font-medium text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function BranchChip({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
      {label}
    </span>
  );
}

export function PullRequestEmptyPanel({
  gitStatus,
  loading,
  creating,
  error,
  project,
  onRefresh,
  onCreatePullRequest,
  onSelectPullRequest,
}: {
  gitStatus: ProjectGitStatusSummary | null;
  loading: boolean;
  creating: boolean;
  error: string | null;
  project: ProjectSummary | null;
  onRefresh: () => void;
  onCreatePullRequest: () => void;
  onSelectPullRequest: (number: number) => void;
}) {
  const createReady = canCreatePullRequest(gitStatus);
  const canShowCreateAction = Boolean(gitStatus?.branch && !gitStatus.isDefaultBranch);
  const createBlocker =
    gitStatus && canShowCreateAction && !createReady
      ? pullRequestCreateBlocker(gitStatus)
      : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className={PR_META_SECTION}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[12px] font-semibold text-muted-foreground">
              <GitPullRequest className="size-3" />
              No PR
            </span>
            <PullRequestSelector
              project={project}
              pullRequest={null}
              onSelect={onSelectPullRequest}
            />
          </div>
          <button
            type="button"
            className={PR_ICON_BUTTON}
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh pull request"
            title="Refresh pull request"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          </button>
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-[14.5px] font-semibold leading-[1.4] text-foreground">
            Pull request
          </h2>
          <p className="text-[12px] leading-[1.55] text-muted-foreground">
            {emptyPullRequestMessage(gitStatus)}
          </p>
        </div>
        {gitStatus ? (
          <div className="flex flex-wrap items-center gap-x-[7px] gap-y-1.5">
            <BranchChip label={gitStatus.branch ?? "detached"} />
            <span className="text-[11.5px] text-(--text-tertiary)">
              {gitStatus.dirtyCount} dirty
            </span>
          </div>
        ) : null}
        {canShowCreateAction ? (
          <Button
            type="button"
            size="sm"
            className="mt-1 self-start"
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
          <p className="text-[11px] text-muted-foreground/70">{createBlocker}</p>
        ) : null}
        {error ? (
          <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            {error}
          </div>
        ) : null}
      </section>
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

export function LocalChangesView({
  files,
}: {
  files: ProjectPullRequestFileSummary[];
}) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => new Set());
  const [expandedTouched, setExpandedTouched] = useState(false);

  const visibleExpandedFiles = useMemo(() => {
    const filenames = new Set(files.map((file) => file.filename));
    const next = new Set(
      [...expandedFiles].filter((filename) => filenames.has(filename)),
    );
    if (!expandedTouched && next.size === 0 && files[0]) {
      next.add(files[0].filename);
    }
    return next;
  }, [expandedFiles, expandedTouched, files]);

  const toggleFile = (filename: string) => {
    setExpandedTouched(true);
    setExpandedFiles(() => {
      const next = new Set(visibleExpandedFiles);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  if (files.length === 0) {
    return <EmptyTabMessage>No changed files reported.</EmptyTabMessage>;
  }

  return (
    <ol className={cn(PR_BODY_PAD, "grid min-w-0 gap-2")}>
      {files.map((file) => {
        const expanded = visibleExpandedFiles.has(file.filename);
        return (
          <li
            key={file.filename}
            className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"
          >
            <button
              type="button"
              onClick={() => toggleFile(file.filename)}
              aria-expanded={expanded}
              aria-controls={diffPanelId(file.filename)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                expanded && "border-b border-layout-border",
              )}
            >
              {expanded ? (
                <ChevronDown className="size-3.5 shrink-0 text-(--text-tertiary)" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0 text-(--text-tertiary)" />
              )}
              <FileKindBadge status={file.status} />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate font-mono text-[12.5px] text-foreground",
                    expanded ? "font-semibold" : "font-normal",
                  )}
                >
                  {file.filename}
                </span>
                {file.previousFilename ? (
                  <span className="block truncate font-mono text-[10.5px] text-(--text-tertiary)">
                    from {file.previousFilename}
                  </span>
                ) : null}
              </span>
              <span className="font-mono text-[11.5px] font-semibold tabular-nums text-success">
                +{file.additions}
              </span>
              <span className="font-mono text-[11.5px] font-semibold tabular-nums text-destructive">
                -{file.deletions}
              </span>
            </button>
            {expanded ? <PatchView file={file} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function FileKindBadge({ status }: { status: string }) {
  const meta = fileStatusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex size-[17px] shrink-0 items-center justify-center rounded-md text-[9.5px] font-bold leading-none",
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
        className: "bg-success/10 text-success",
      };
    case "modified":
    case "changed":
      return {
        char: "M",
        label: "Modified",
        className: "bg-primary/10 text-primary",
      };
    case "removed":
    case "deleted":
      return {
        char: "D",
        label: "Deleted",
        className: "bg-destructive/10 text-destructive",
      };
    case "renamed":
      return {
        char: "R",
        label: "Renamed",
        className: "bg-info/10 text-info",
      };
    default:
      return {
        char: status.slice(0, 1).toUpperCase() || "?",
        label: status || "Unknown",
        className: "bg-secondary text-muted-foreground",
      };
  }
}

function PatchView({ file }: { file: ProjectPullRequestFileSummary }) {
  return (
    <div
      id={diffPanelId(file.filename)}
      className="min-w-0 max-w-full overflow-hidden"
    >
      <PatchDiffView
        patch={file.patch}
        filename={file.filename}
        previousFilename={file.previousFilename}
        status={file.status}
        variant="embedded"
      />
    </div>
  );
}

function diffPanelId(filename: string): string {
  return `diff-${filename.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function ChecksView({
  pullRequest,
  projectId,
  onRefresh,
}: {
  pullRequest: ProjectPullRequestSummary;
  projectId: string | null;
  onRefresh: () => void;
}) {
  const meta = checkStateMeta(pullRequest.checks.state);
  if (pullRequest.checks.total === 0) {
    return <EmptyTabMessage>No check runs reported.</EmptyTabMessage>;
  }

  return (
    <div className={cn(PR_BODY_PAD, "min-w-0 max-w-full")}>
      <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2 pb-1">
        <meta.Icon className={cn("size-4 shrink-0", meta.className)} />
        <span className="text-[13px] font-semibold text-foreground">
          {meta.label}
        </span>
        <span className="font-mono text-[11.5px] text-(--text-tertiary)">
          {pullRequest.checks.passed} passed · {pullRequest.checks.pending} pending ·{" "}
          {pullRequest.checks.failed} failed
        </span>
      </div>
      <ol className="grid min-w-0 max-w-full gap-2">
        {pullRequest.checks.runs.map((run) => (
          <li key={`${run.name}:${run.id ?? ""}`} className="min-w-0 max-w-full">
            <CheckRunRow
              run={run}
              projectId={projectId}
              onRefresh={onRefresh}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function CheckRunRow({
  run,
  projectId,
  onRefresh,
}: {
  run: ProjectPullRequestCheckSummary;
  projectId: string | null;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobId = run.workflowJobId;
  const canLoadLogs = Boolean(projectId && jobId);
  const canRerun = Boolean(projectId && jobId && run.canRerun);

  const fetchLogs = async () => {
    if (!projectId || !jobId) return;
    setLoadingLogs(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/github/actions/jobs/${jobId}/logs`);
      if (!res.ok) {
        throw new Error(await responseError(res, "Failed to load logs"));
      }
      const data = await res.text();
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoadingLogs(false);
    }
  };

  const rerunJob = async () => {
    if (!projectId || !jobId || !run.canRerun) return;
    setRerunning(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/github/actions/jobs/${jobId}/rerun`,
        { method: "POST" },
      );
      if (!res.ok) {
        throw new Error(await responseError(res, "Failed to rerun job"));
      }
      setLogs(null);
      onRefresh();
    } catch (err) {
      setExpanded(true);
      setError(err instanceof Error ? err.message : "Failed to rerun job");
    } finally {
      setRerunning(false);
    }
  };

  const toggleExpand = () => {
    if (!canLoadLogs) return;
    const next = !expanded;
    setExpanded(next);
    if (next && !logs) {
      void fetchLogs();
    }
  };

  const runMeta = runStateMeta(run);
  const statusLabel = run.conclusion ?? run.status;
  const statusToneClass =
    run.status !== "completed"
      ? "text-warning"
      : ["success", "neutral", "skipped"].includes(run.conclusion ?? "")
        ? "text-success"
        : "text-destructive";

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
        <runMeta.Icon className={cn("size-4 shrink-0", runMeta.className)} />
        <button
          type="button"
          onClick={toggleExpand}
          disabled={!canLoadLogs}
          className="min-w-0 flex-1 text-left focus-visible:outline-none disabled:cursor-default"
          title={canLoadLogs ? "View logs" : "No workflow job logs available for this check"}
        >
          <span className="block truncate text-[13px] font-semibold text-foreground">
            {run.name}
          </span>
          <span className="mt-[3px] flex min-w-0 items-center gap-1.5 font-mono text-[11px]">
            <span className={cn("font-semibold", statusToneClass)}>{statusLabel}</span>
            <span className="text-(--text-tertiary)">|</span>
            <span className="truncate text-(--text-tertiary)">
              {jobId ? `job ${jobId}` : "GitHub check"}
            </span>
          </span>
        </button>

        <div
          className="flex shrink-0 items-center gap-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          {run.htmlUrl ?? run.detailsUrl ? (
            <a
              href={run.htmlUrl ?? run.detailsUrl ?? ""}
              target="_blank"
              rel="noreferrer"
              className={PR_ICON_BUTTON}
              title="Open check on GitHub"
            >
              <ExternalLink className="size-3" />
            </a>
          ) : null}
          {canRerun ? (
            <button
              type="button"
              className={PR_ICON_BUTTON}
              onClick={rerunJob}
              disabled={rerunning}
              title="Rerun failed job"
            >
              {rerunning ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RotateCcw className="size-3" />
              )}
            </button>
          ) : null}
          {canLoadLogs ? (
            <button
              type="button"
              className={cn(
                PR_ICON_BUTTON,
                expanded && "text-muted-foreground",
              )}
              onClick={toggleExpand}
              title="View logs"
            >
              {expanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <FileText className="size-3" />
              )}
            </button>
          ) : null}
        </div>
      </div>

      {expanded && (
        <div className="px-[11px] pb-2.5">
          {loadingLogs ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-layout-border bg-background px-2.5 py-3 text-[11.5px] text-(--text-tertiary)">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Loading logs from GitHub...</span>
            </div>
          ) : error ? (
            <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
              <span className="min-w-0 whitespace-pre-wrap break-words">{error}</span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="h-5 shrink-0 px-1.5 text-[9px]"
                onClick={fetchLogs}
              >
                Retry
              </Button>
            </div>
          ) : logs ? (
            <div className="relative min-w-0 max-w-full">
              <pre className="block max-h-72 w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border border-layout-border bg-background px-3 py-2.5 font-mono text-[10px] leading-relaxed text-foreground/90 wrap-break-word">
                {logs}
              </pre>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
                  onClick={fetchLogs}
                  disabled={loadingLogs}
                >
                  <RefreshCw className="size-3" />
                  Reload Logs
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-layout-border bg-background py-2 text-center text-[11.5px] text-(--text-tertiary)">
              No logs available.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function responseError(res: Response, fallback: string): Promise<string> {
  const json = (await res.clone().json().catch(() => null)) as { error?: unknown } | null;
  if (typeof json?.error === "string") {
    return json.error;
  }
  const text = await res.text().catch(() => "");
  return text || fallback;
}

function DescriptionView({ description }: { description: string | null }) {
  const body = description?.trim();

  if (!body) {
    return <EmptyTabMessage>No PR description provided.</EmptyTabMessage>;
  }

  return (
    <div className={PR_BODY_PAD}>
      <article className="min-w-0 rounded-xl border border-border bg-card px-4 py-3.5">
        <Markdown className={PR_MARKDOWN_CLASSNAME}>{body}</Markdown>
      </article>
    </div>
  );
}

function DiscussionView({ items }: { items: ProjectPullRequestDiscussionItem[] }) {
  if (items.length === 0) {
    return <EmptyTabMessage>No discussion comments reported.</EmptyTabMessage>;
  }

  const orderedItems = orderDiscussionItems(items);
  const depthById = getDiscussionDepths(items);

  return (
    <ol className={cn(PR_BODY_PAD, "grid min-w-0 gap-2")}>
      {orderedItems.map((item) => {
        const depth = depthById.get(item.id) ?? 0;
        const isReply = depth > 0;
        const isBot = item.authorLogin.endsWith("[bot]");

        return (
          <li
            key={`${item.kind}:${item.id}`}
            className={cn("min-w-0", isReply && "ml-3 border-l border-border pl-2")}
          >
            <article className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex min-w-0 items-center gap-2 border-b border-layout-border px-3 py-2.5">
                {isBot ? (
                  <Bot className="size-4 shrink-0 text-(--text-tertiary)" />
                ) : (
                  <MessageSquare className="size-4 shrink-0 text-(--text-tertiary)" />
                )}
                <span className="truncate text-[12.5px] font-semibold text-foreground">
                  {item.authorLogin}
                </span>
                <span className="shrink-0 text-[11.5px] text-(--text-tertiary)">
                  {relativeTime(item.createdAt)}
                </span>
                <span className="shrink-0 rounded-md border border-border bg-secondary px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                  {item.kind === "review_comment" ? "Review" : "Comment"}
                </span>
                <span className="min-w-0 flex-1" />
                <a
                  href={item.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={PR_ICON_BUTTON}
                  title="Open comment on GitHub"
                >
                  <ExternalLink className="size-3" />
                </a>
              </div>
              <div className="flex flex-col gap-2 px-3 py-2.5">
                {item.path ? (
                  <span className="inline-flex max-w-full items-center gap-1.5 self-start rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                    <FileCode className="size-3 shrink-0 text-(--text-tertiary)" />
                    <span className="truncate">
                      {item.path}
                      {item.line ? `:${item.line}` : ""}
                    </span>
                  </span>
                ) : null}
                <Markdown className={PR_MARKDOWN_CLASSNAME}>{item.body}</Markdown>
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

function getDiscussionDepths(
  items: ProjectPullRequestDiscussionItem[],
): Map<number, number> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const depthById = new Map<number, number>();

  const resolveDepth = (item: ProjectPullRequestDiscussionItem): number => {
    const cached = depthById.get(item.id);
    if (cached !== undefined) return cached;

    const parentId = item.inReplyToId;
    const parent = parentId ? byId.get(parentId) : undefined;
    const depth = parent ? Math.min(resolveDepth(parent) + 1, 2) : 0;
    depthById.set(item.id, depth);
    return depth;
  };

  for (const item of items) {
    resolveDepth(item);
  }

  return depthById;
}

function orderDiscussionItems(
  items: ProjectPullRequestDiscussionItem[],
): ProjectPullRequestDiscussionItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const childrenByParent = new Map<number, ProjectPullRequestDiscussionItem[]>();
  const roots: ProjectPullRequestDiscussionItem[] = [];

  for (const item of items) {
    if (item.inReplyToId && byId.has(item.inReplyToId)) {
      const siblings = childrenByParent.get(item.inReplyToId) ?? [];
      siblings.push(item);
      childrenByParent.set(item.inReplyToId, siblings);
    } else {
      roots.push(item);
    }
  }

  const byCreatedAt = (
    left: ProjectPullRequestDiscussionItem,
    right: ProjectPullRequestDiscussionItem,
  ) => left.createdAt - right.createdAt;
  roots.sort(byCreatedAt);
  for (const children of childrenByParent.values()) {
    children.sort(byCreatedAt);
  }

  const ordered: ProjectPullRequestDiscussionItem[] = [];
  const visited = new Set<number>();
  const append = (item: ProjectPullRequestDiscussionItem) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    ordered.push(item);
    for (const child of childrenByParent.get(item.id) ?? []) {
      append(child);
    }
  };

  for (const root of roots) {
    append(root);
  }

  return ordered;
}

function CommitsView({
  commits,
}: {
  commits: ProjectPullRequestCommitSummary[];
}) {
  if (commits.length === 0) {
    return <EmptyTabMessage>No commits reported.</EmptyTabMessage>;
  }

  return (
    <ol className={cn(PR_BODY_PAD, "grid min-w-0 gap-2")}>
      {commits.map((commit) => (
        <li
          key={commit.sha}
          className="min-w-0 rounded-xl border border-border bg-card px-3 py-2.5"
        >
          <div className="flex min-w-0 items-start gap-2">
            <GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-(--text-tertiary)" />
            <a
              href={commit.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-[1.4] text-foreground hover:underline"
            >
              {commit.title}
            </a>
            <a
              href={commit.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(PR_ICON_BUTTON, "mt-0.5")}
              title="Open commit on GitHub"
            >
              <ExternalLink className="size-3" />
            </a>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 pl-6">
            <span className="truncate text-[11.5px] text-muted-foreground">
              {commit.authorLogin ?? commit.authorName}
            </span>
            <span className="text-[11.5px] text-(--text-tertiary)">
              {relativeTime(commit.committedAt)}
            </span>
            <span className="rounded-md border border-border bg-secondary px-1.5 py-px font-mono text-[10.5px] text-muted-foreground">
              {commit.shortSha}
            </span>
          </div>
          {commit.message !== commit.title ? (
            <pre className="mt-2 min-w-0 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-layout-border bg-background px-3 py-2.5 font-mono text-[10.5px] leading-[1.5] text-muted-foreground">
              {commit.message}
            </pre>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function EmptyTabMessage({ children }: { children: ReactNode }) {
  return (
    <div className={cn(PR_BODY_PAD, "text-center text-[12px] text-(--text-tertiary)")}>
      {children}
    </div>
  );
}

function relativeTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "";
  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const divisions = [
    { amount: 60, unit: "second" },
    { amount: 60, unit: "minute" },
    { amount: 24, unit: "hour" },
    { amount: 7, unit: "day" },
    { amount: 4.345, unit: "week" },
    { amount: 12, unit: "month" },
    { amount: Number.POSITIVE_INFINITY, unit: "year" },
  ] as const;
  let duration = diffSeconds;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return new Intl.RelativeTimeFormat(undefined, {
        numeric: "auto",
      }).format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return "";
}

function relativePullRequestTime(timestamp: number): string {
  return relativeTime(timestamp);
}

type PullRequestSort =
  | "updated-desc"
  | "updated-asc"
  | "created-desc"
  | "created-asc"
  | "number-desc"
  | "number-asc"
  | "title-asc";

const PULL_REQUEST_SORT_OPTIONS = [
  { value: "updated-desc", label: "Recent" },
  { value: "updated-asc", label: "Oldest" },
  { value: "created-desc", label: "Newest" },
  { value: "created-asc", label: "Earliest" },
  { value: "number-desc", label: "# ↓" },
  { value: "number-asc", label: "# ↑" },
  { value: "title-asc", label: "Title A-Z" },
] as const satisfies readonly PopupSortOption<PullRequestSort>[];

function sortPullRequests(
  items: ProjectPullRequestListItem[],
  sort: PullRequestSort,
): ProjectPullRequestListItem[] {
  const sorted = [...items];
  switch (sort) {
    case "updated-desc":
      return sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    case "updated-asc":
      return sorted.sort((a, b) => a.updatedAt - b.updatedAt);
    case "created-desc":
      return sorted.sort((a, b) => b.createdAt - a.createdAt);
    case "created-asc":
      return sorted.sort((a, b) => a.createdAt - b.createdAt);
    case "number-desc":
      return sorted.sort((a, b) => b.number - a.number);
    case "number-asc":
      return sorted.sort((a, b) => a.number - b.number);
    case "title-asc":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
  }
}

export function PullRequestSelector({
  project,
  pullRequest,
  onSelect,
}: {
  project: ProjectSummary | null;
  pullRequest: ProjectPullRequestSummary | null;
  onSelect: (number: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pullRequests, setPullRequests] = useState<ProjectPullRequestListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pullRequestSort, setPullRequestSort] =
    useState<PullRequestSort>("updated-desc");
  const label = pullRequest ? `PR #${pullRequest.number}` : "PR";

  const filteredPullRequests = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? pullRequests.filter((item) =>
          [
            `#${item.number}`,
            item.title,
            item.authorLogin,
            item.baseBranch,
            item.headBranch,
          ].some((value) => value.toLowerCase().includes(needle)),
        )
      : pullRequests;
    return sortPullRequests(filtered, pullRequestSort);
  }, [pullRequests, pullRequestSort, query]);

  const loadPullRequests = useCallback(async () => {
    if (!project || project.provider !== "github" || project.status !== "ready") return;
    setLoading(true);
    try {
      const data = await getJson<{ pullRequests: ProjectPullRequestListItem[] }>(
        `/api/projects/${project.id}/github/pull-requests`,
      );
      setPullRequests(data.pullRequests);
      setError(null);
    } catch (err) {
      setPullRequests([]);
      setError(errorMessage(err, "Failed to load pull requests"));
    } finally {
      setLoading(false);
    }
  }, [project]);

  const selectPullRequest = (item: ProjectPullRequestListItem) => {
    setSelecting(item.number);
    onSelect(item.number);
    setOpen(false);
    window.setTimeout(() => setSelecting(null), 600);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadPullRequests();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1 font-mono text-[12px] text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={pullRequest ? `Select pull request, current ${label}` : "Select pull request"}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-(--text-tertiary)" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-[360px] overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-layout-border px-3 py-2.5">
          <Search className="size-4 shrink-0 text-(--text-tertiary)" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pull requests"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-(--text-tertiary)"
            aria-label="Search pull requests"
          />
          <button
            type="button"
            onClick={() => void loadPullRequests()}
            disabled={loading}
            className={PR_ICON_BUTTON}
            aria-label="Refresh pull requests"
            title="Refresh pull requests"
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--text-tertiary)">
              Pull requests
            </span>
            <PopupSortSelect
              value={pullRequestSort}
              options={PULL_REQUEST_SORT_OPTIONS}
              onChange={setPullRequestSort}
              aria-label="Sort pull requests"
            />
          </div>
          {error ? (
            <div className="mx-2 mb-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
              {error}
            </div>
          ) : filteredPullRequests.length === 0 ? (
            <div className="px-3 py-6 text-center text-[11.5px] text-(--text-tertiary)">
              {loading ? "Loading pull requests..." : "No pull requests found."}
            </div>
          ) : (
            <ul className="grid gap-0.5 px-1.5 pb-1.5">
              {filteredPullRequests.map((item) => {
                const selected = pullRequest?.number === item.number;
                const stateLabel = item.merged
                  ? "Merged"
                  : item.state === "open"
                    ? "Open"
                    : "Closed";
                return (
                  <li key={item.number}>
                    <button
                      type="button"
                      onClick={() => selectPullRequest(item)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-md px-2 py-[7px] text-left transition-colors hover:bg-secondary/60 disabled:opacity-60",
                        selected && "bg-secondary",
                      )}
                    >
                      <span className="pt-px">
                        {selecting === item.number ? (
                          <Loader2 className="size-4 animate-spin text-primary" />
                        ) : (
                          <PullRequestStateIcon item={item} />
                        )}
                      </span>
                      <span className="grid min-w-0 flex-1 gap-[3px]">
                        <span
                          className={cn(
                            "truncate text-[12.5px] text-foreground",
                            selected ? "font-semibold" : "font-medium",
                          )}
                        >
                          #{item.number} {item.title}
                        </span>
                        <span className="truncate font-mono text-[10.5px] text-(--text-tertiary)">
                          {item.headBranch} → {item.baseBranch} · {stateLabel} ·{" "}
                          {relativePullRequestTime(item.updatedAt)}
                        </span>
                      </span>
                      {selected ? (
                        <Check className="mt-px size-4 shrink-0 text-primary" />
                      ) : null}
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

function PullRequestStateIcon({ item }: { item: ProjectPullRequestListItem }) {
  if (item.merged) {
    return <GitMerge className="size-4 text-thought" />;
  }
  return (
    <GitPullRequest
      className={cn(
        "size-4",
        item.state === "open" ? "text-success" : "text-(--text-tertiary)",
      )}
    />
  );
}

function StateBadge({
  pullRequest,
}: {
  pullRequest: ProjectPullRequestSummary;
}) {
  const merged = pullRequest.merged;
  const open = !merged && pullRequest.state === "open";
  const label = merged ? "Merged" : open ? "Open" : "Closed";
  const className = merged
    ? "bg-thought/12 text-thought"
    : open
      ? "bg-success/10 text-success"
      : "bg-secondary text-muted-foreground";
  const Icon = merged ? GitMerge : GitPullRequest;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
        className,
      )}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}

function checkStateMeta(state: ProjectPullRequestSummary["checks"]["state"]) {
  switch (state) {
    case "success":
      return { Icon: CheckCircle2, label: "Checks passed", className: "text-success" };
    case "failure":
      return { Icon: XCircle, label: "Checks failed", className: "text-destructive" };
    case "error":
      return { Icon: AlertCircle, label: "Checks errored", className: "text-destructive" };
    case "pending":
      return { Icon: Clock, label: "Checks pending", className: "text-warning" };
    case "unknown":
      return { Icon: AlertCircle, label: "Checks unknown", className: "text-muted-foreground" };
  }
}

function runStateMeta(
  run: ProjectPullRequestSummary["checks"]["runs"][number],
) {
  if (run.status !== "completed") {
    return { Icon: Clock, className: "text-warning" };
  }
  if (["success", "neutral", "skipped"].includes(run.conclusion ?? "")) {
    return { Icon: CheckCircle2, className: "text-success" };
  }
  return { Icon: XCircle, className: "text-destructive" };
}
