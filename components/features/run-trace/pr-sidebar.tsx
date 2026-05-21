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
  Loader2,
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
  ProjectPullRequestCommitSummary,
  ProjectPullRequestDiscussionItem,
  ProjectPullRequestFileSummary,
  ProjectPullRequestSummary,
  ProjectPullRequestCheckSummary,
} from "@/src/lib/api-types";
import { Markdown } from "@/components/features/chat/markdown";
import { PatchDiffView } from "./diff-view";

export function PullRequestPanel({
  pullRequest,
  loading,
  error,
  projectId,
  onRefresh,
}: {
  pullRequest: ProjectPullRequestSummary;
  gitStatus: ProjectGitStatusSummary | null;
  loading: boolean;
  error: string | null;
  projectId: string | null;
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
              <span className="text-muted-foreground/50">|</span>
              <InlineStat value={pullRequest.changedFiles} label="files" />
              <InlineStat value={`+${pullRequest.additions}`} tone="add" />
              <InlineStat value={`-${pullRequest.deletions}`} tone="delete" />
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
            <TabsTrigger value="description" className="h-6 px-2 py-0 text-[11px]">
              Description
            </TabsTrigger>
            <TabsTrigger value="discussion" className="h-6 px-2 py-0 text-[11px]">
              Discussion {pullRequest.discussion.length}
            </TabsTrigger>
            <TabsTrigger value="commits" className="h-6 px-2 py-0 text-[11px]">
              Commits {pullRequest.commitItems.length}
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
        <TabsContent value="description" className="m-0">
          <DescriptionView description={pullRequest.description} />
        </TabsContent>
        <TabsContent value="discussion" className="m-0">
          <DiscussionView items={pullRequest.discussion} />
        </TabsContent>
        <TabsContent value="commits" className="m-0">
          <CommitsView commits={pullRequest.commitItems} />
        </TabsContent>
        <TabsContent value="checks" className="m-0">
          <ChecksView
            pullRequest={pullRequest}
            projectId={projectId}
          />
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
  projectId,
}: {
  pullRequest: ProjectPullRequestSummary;
  projectId: string | null;
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
    <div className="min-w-0 max-w-full px-2 py-2">
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <meta.Icon className={cn("size-3.5", meta.className)} />
        <span className="font-medium">{meta.label}</span>
        <span className="text-muted-foreground">
          {pullRequest.checks.passed} passed / {pullRequest.checks.pending} pending /{" "}
          {pullRequest.checks.failed} failed
        </span>
      </div>
      <ol className="grid min-w-0 max-w-full gap-1">
        {pullRequest.checks.runs.map((run) => (
          <li key={`${run.name}:${run.id ?? ""}`} className="min-w-0 max-w-full">
            <CheckRunRow
              run={run}
              projectId={projectId}
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
}: {
  run: ProjectPullRequestCheckSummary;
  projectId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    if (!projectId || !run.id) return;
    setLoadingLogs(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/github/check-runs/${run.id}/logs`);
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

  const toggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !logs) {
      void fetchLogs();
    }
  };

  const runMeta = runStateMeta(run);

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-border/40 bg-background/20">
      <div className="flex min-w-0 items-center justify-between gap-2 px-2 py-1.5 text-xs hover:bg-accent/15">
        <button
          type="button"
          onClick={toggleExpand}
          className="grid min-w-0 flex-1 grid-cols-[0.875rem_1fr] items-center gap-2 text-left"
        >
          <runMeta.Icon className={cn("size-3.5 shrink-0", runMeta.className)} />
          <span className="min-w-0 truncate font-medium">{run.name}</span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {run.htmlUrl ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              asChild
              title="Open check on GitHub"
            >
              <a href={run.htmlUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3" />
              </a>
            </Button>
          ) : null}
          {projectId && run.id ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={toggleExpand}
              title="View logs"
            >
              <FileText className="size-3" />
            </Button>
          ) : null}
        </div>
      </div>

      {expanded && (
        <div className="min-w-0 max-w-full border-t border-border/40 bg-background/50 p-2 font-mono text-[10px]">
          {loadingLogs ? (
            <div className="flex items-center gap-2 text-muted-foreground py-2 justify-center">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Loading logs from GitHub...</span>
            </div>
          ) : error ? (
            <div className="flex min-w-0 items-center justify-between gap-2 py-1 text-destructive">
              <span className="min-w-0 whitespace-pre-wrap break-words">{error}</span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="h-5 px-1.5 text-[9px]"
                onClick={fetchLogs}
              >
                Retry
              </Button>
            </div>
          ) : logs ? (
            <div className="relative min-w-0 max-w-full">
              <pre className="block max-h-72 w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 font-mono text-[10px] leading-normal text-foreground/90 wrap-break-word">
                {logs}
              </pre>
              <div className="mt-1.5 flex justify-end">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="h-5 px-2 text-[9px]"
                  onClick={fetchLogs}
                  disabled={loadingLogs}
                >
                  <RefreshCw className="mr-1 size-2.5" />
                  Reload Logs
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-1 text-center font-sans text-muted-foreground">No logs available.</div>
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
    return (
      <div className="px-3 py-8 text-center text-xs text-muted-foreground">
        No PR description provided.
      </div>
    );
  }

  return (
    <div className="px-2 py-2">
      <article className="min-w-0 rounded-md bg-background/45 px-2.5 py-2 ring-1 ring-border">
        <Markdown className="min-w-0 space-y-1 text-xs leading-snug wrap-break-word [&_h1]:mt-1 [&_h1]:text-sm [&_h1]:leading-tight [&_h2]:mt-1 [&_h2]:text-sm [&_h2]:leading-tight [&_h3]:mt-1 [&_h3]:leading-tight [&_li]:leading-snug [&_ol]:space-y-0 [&_p]:leading-snug [&_table]:text-[11px] [&_td]:px-1.5 [&_td]:py-0.5 [&_th]:px-1.5 [&_th]:py-0.5 [&_ul]:space-y-0">
          {body}
        </Markdown>
      </article>
    </div>
  );
}

function DiscussionView({ items }: { items: ProjectPullRequestDiscussionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-xs text-muted-foreground">
        No discussion comments reported.
      </div>
    );
  }

  const orderedItems = orderDiscussionItems(items);
  const depthById = getDiscussionDepths(items);

  return (
    <ol className="grid min-w-0 gap-1.5 px-2 py-2">
      {orderedItems.map((item) => {
        const depth = depthById.get(item.id) ?? 0;
        const isReply = depth > 0;

        return (
          <li
            key={`${item.kind}:${item.id}`}
            className={cn(
              "min-w-0",
              isReply && "ml-3 border-l border-border pl-2",
            )}
          >
            <article className="min-w-0 rounded-md bg-background/45 px-2.5 py-2 ring-1 ring-border">
              <div className="mb-1.5 flex min-w-0 items-start justify-between gap-2">
                <div className="grid min-w-0 grid-cols-[0.875rem_minmax(0,1fr)] items-start gap-2">
                  <MessageSquare
                    className={cn(
                      "mt-0.5 size-3.5 text-muted-foreground",
                      isReply && "text-foreground/70",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                      <span className="truncate font-semibold">{item.authorLogin}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {relativeTime(item.createdAt)}
                      </span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {item.kind === "review_comment" ? "Review" : "Comment"}
                      </span>
                    </div>
                    {item.path ? (
                      <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                        {item.path}
                        {item.line ? `:${item.line}` : ""}
                      </div>
                    ) : null}
                  </div>
                </div>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  asChild
                  title="Open comment on GitHub"
                >
                  <a href={item.htmlUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3" />
                  </a>
                </Button>
              </div>
              <Markdown className="min-w-0 space-y-1 text-xs leading-snug wrap-break-word [&_h1]:mt-1 [&_h1]:text-sm [&_h1]:leading-tight [&_h2]:mt-1 [&_h2]:text-sm [&_h2]:leading-tight [&_h3]:mt-1 [&_h3]:leading-tight [&_li]:leading-snug [&_ol]:space-y-0 [&_p]:leading-snug [&_table]:text-[11px] [&_td]:px-1.5 [&_td]:py-0.5 [&_th]:px-1.5 [&_th]:py-0.5 [&_ul]:space-y-0">
                {item.body}
              </Markdown>
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
    return (
      <div className="px-3 py-8 text-center text-xs text-muted-foreground">
        No commits reported.
      </div>
    );
  }

  return (
    <ol className="grid min-w-0 gap-1.5 px-2 py-2">
      {commits.map((commit) => (
        <li
          key={commit.sha}
          className="grid min-w-0 grid-cols-[0.875rem_minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-border/40 bg-background/20 px-2 py-1.5 text-xs hover:bg-accent/25"
        >
          <GitCommit className="mt-0.5 size-3.5 text-muted-foreground" />
          <div className="min-w-0">
            <a
              href={commit.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="block truncate font-semibold hover:underline"
            >
              {commit.title}
            </a>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="truncate">{commit.authorLogin ?? commit.authorName}</span>
              <span>{relativeTime(commit.committedAt)}</span>
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
                {commit.shortSha}
              </span>
            </div>
            {commit.message !== commit.title ? (
              <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-1.5 font-mono text-[10px] leading-normal text-muted-foreground">
                {commit.message}
              </pre>
            ) : null}
          </div>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            asChild
            title="Open commit on GitHub"
          >
            <a href={commit.htmlUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3" />
            </a>
          </Button>
        </li>
      ))}
    </ol>
  );
}

function InlineStat({
  value,
  label,
  tone,
}: {
  value: string | number;
  label?: string;
  tone?: "add" | "delete";
}) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        tone === "add" && "text-emerald-400",
        tone === "delete" && "text-destructive",
      )}
    >
      {value}
      {label ? <span className="ml-1 text-muted-foreground">{label}</span> : null}
    </span>
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
