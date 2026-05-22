"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatAddToolApproveResponseFunction } from "ai";
import {
  Check,
  CheckCircle2,
  FileText,
  GitBranch,
  FolderTree,
  ListTodo,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Search,
  TerminalSquare,
  X,
  XCircle,
} from "lucide-react";

import {
  getAssistantTextDisplay,
  getPlanMessages,
  getToolTraceEntries,
  getApprovalMetadata,
  type AntonUIMessage,
  type ToolTraceEntry,
} from "@/src/lib/trace";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/features/chat/markdown";
import { DiffView } from "./diff-view";
import {
  isOkWriteFileOutput,
  isOkEditFileOutput,
  effectiveToolState,
  pickString,
  previewToolInput,
  riskCategoryBadge,
  safeStringify,
  toolStateMeta,
  type WriteFileOkOutput,
} from "./tool-display";
import { TerminalOutput } from "./terminal-output";
import { LiveTerminalOutput } from "./live-terminal";
import { ApprovalDetails } from "./approval-details";
import { TodoCard } from "./todo-card";
import { getSessionTodoSnapshots } from "./trace-data";
import { PullRequestEmptyPanel, PullRequestPanel } from "./pr-sidebar";
import { ProjectFilesPanel } from "./project-files-panel";
import { errorMessage, getJson, jsonHeaders, requestJson } from "@/src/lib/client-fetch";
import { PROJECT_GIT_CHANGED_EVENT } from "@/components/features/projects/hooks";
import type {
  ProjectGitStatusSummary,
  ProjectLocalDiffSummary,
  ProjectPullRequestListItem,
  ProjectPullRequestSummary,
  ProjectSummary,
} from "@/src/lib/api-types";

export type WorklogEntry = ToolTraceEntry;
type SidebarTab = "worklog" | "plans" | "todos" | "pr" | "files";

interface WorklogProps {
  messages: AntonUIMessage[];
  onApproval: ChatAddToolApproveResponseFunction;
  project: ProjectSummary | null;
  className?: string;
  onClose?: () => void;
  visible?: boolean;
  expanded?: boolean;
  onExpandToggle?: () => void;
}

export function Worklog({
  messages,
  onApproval,
  project,
  className,
  onClose,
  visible = true,
  expanded = false,
  onExpandToggle,
}: WorklogProps) {
  const [tabs, setTabs] = useState<SidebarTab[]>(["worklog"]);
  const [activeTab, setActiveTab] = useState<SidebarTab | null>("worklog");
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastAutoPr, setLastAutoPr] = useState<number | null>(null);
  const prState = useProjectPullRequest(project, {
    enabled: visible,
    poll: visible && activeTab === "pr",
  });
  const hasGithubProject = project?.provider === "github" && project.status === "ready";
  const pullRequestNumber = prState.pullRequest?.number ?? null;

  const addTab = (tab: SidebarTab) => {
    setTabs((current) => (current.includes(tab) ? current : [...current, tab]));
    setActiveTab(tab);
    setMenuOpen(false);
  };

  const closeTab = (tab: SidebarTab) => {
    setTabs((current) => {
      const nextTabs = current.filter((item) => item !== tab);
      setActiveTab((currentActive) =>
        currentActive === tab ? (nextTabs.at(-1) ?? null) : currentActive,
      );
      return nextTabs;
    });
    setMenuOpen(false);
  };

  useEffect(() => {
    if (pullRequestNumber === null && !hasGithubProject) {
      queueMicrotask(() => {
        setTabs((current) => current.filter((tab) => tab !== "pr"));
        setActiveTab((current) => (current === "pr" ? "worklog" : current));
        setLastAutoPr(null);
      });
      return;
    }
    if (pullRequestNumber === null || !visible || lastAutoPr === pullRequestNumber) {
      return;
    }
    queueMicrotask(() => {
      setTabs((current) => (current.includes("pr") ? current : [...current, "pr"]));
      setActiveTab("pr");
      setLastAutoPr(pullRequestNumber);
    });
  }, [hasGithubProject, lastAutoPr, pullRequestNumber, visible]);

  const availableTabs = SIDEBAR_TABS.filter(
    (tab) =>
      !tabs.includes(tab.id) &&
      (tab.id !== "pr" || hasGithubProject || prState.pullRequest !== null),
  );

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-l border-border bg-card/35",
        className,
      )}
      aria-label="Trace workspace"
    >
      <div className="flex h-full min-w-0 w-full shrink-0 flex-col xl:min-w-[420px]">
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-2">
          <div className="flex min-w-0 items-center gap-1">
            {tabs.map((tab) => {
              const meta = tabMeta(tab, prState.pullRequest);
              return (
                <div
                  key={tab}
                  className={cn(
                    "inline-flex h-7 min-w-0 items-center rounded text-xs font-semibold transition-colors",
                    activeTab === tab
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                  role="group"
                  aria-label={`${meta.label} tab`}
                >
                  <button
                    type="button"
                    onClick={() => closeTab(tab)}
                    className="group/close relative ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-background/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={`Close ${meta.label} tab`}
                    title={`Close ${meta.label}`}
                  >
                    <meta.Icon className="size-3.5 transition-opacity group-hover/close:opacity-0 group-focus-visible/close:opacity-0" />
                    <X className="absolute size-3.5 opacity-0 transition-opacity group-hover/close:opacity-100 group-focus-visible/close:opacity-100" />
                  </button>
                  {tab === "pr" ? (
                    <PullRequestTabSelector
                      project={project}
                      pullRequest={prState.pullRequest}
                      active={activeTab === tab}
                      onActivate={() => setActiveTab(tab)}
                      onSelect={prState.selectPullRequest}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className="min-w-0 rounded py-1 pl-0.5 pr-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-pressed={activeTab === tab}
                    >
                      <span className="block truncate">{meta.label}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <div className="relative">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => setMenuOpen((open) => !open)}
                disabled={availableTabs.length === 0}
                aria-label="Add sidebar tab"
                aria-expanded={menuOpen}
              >
                <Plus />
              </Button>
              {menuOpen && availableTabs.length > 0 && (
                <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-md bg-popover p-1 text-xs text-popover-foreground shadow-lg ring-1 ring-border">
                  {availableTabs.map((tab) => {
                    const meta = tabMeta(tab.id, prState.pullRequest);
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                        onClick={() => addTab(tab.id)}
                      >
                        <meta.Icon className="size-3.5 text-muted-foreground" />
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {onExpandToggle && (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={onExpandToggle}
                aria-label={expanded ? "Shrink trace workspace" : "Expand trace workspace"}
                aria-pressed={expanded}
              >
                {expanded ? <Minimize2 /> : <Maximize2 />}
              </Button>
            )}
            {onClose && (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={onClose}
                aria-label="Close trace workspace"
              >
                <X />
              </Button>
            )}
          </div>
        </header>

        {activeTab === "worklog" ? (
          <WorklogPanel messages={messages} onApproval={onApproval} />
        ) : activeTab === "plans" ? (
          <PlansPanel messages={messages} />
        ) : activeTab === "todos" ? (
          <TodosPanel messages={messages} />
        ) : activeTab === "files" ? (
          <ProjectFilesPanel project={project} visible={visible} />
        ) : activeTab === "pr" && prState.pullRequest ? (
          <PullRequestPanel
            pullRequest={prState.pullRequest}
            gitStatus={prState.gitStatus}
            loading={prState.loading}
            error={prState.error}
            projectId={project?.id ?? null}
            onRefresh={prState.refresh}
          />
        ) : activeTab === "pr" && hasGithubProject ? (
          <PullRequestEmptyPanel
            gitStatus={prState.gitStatus}
            localFiles={prState.localDiff?.files ?? []}
            loading={prState.loading}
            creating={prState.creating}
            error={prState.error}
            onRefresh={prState.refresh}
            onCreatePullRequest={prState.createPullRequest}
          />
        ) : (
          <EmptyTabsPanel />
        )}
      </div>
    </aside>
  );
}

const SIDEBAR_TABS = [
  { id: "worklog", label: "Worklog", Icon: TerminalSquare },
  { id: "plans", label: "Plans", Icon: FileText },
  { id: "todos", label: "Todos", Icon: ListTodo },
  { id: "pr", label: "PR", Icon: GitBranch },
  { id: "files", label: "Files", Icon: FolderTree },
] as const satisfies readonly {
  id: SidebarTab;
  label: string;
  Icon: typeof TerminalSquare;
}[];

const PR_POLL_INTERVAL_MS = 120_000;

function tabMeta(
  tab: SidebarTab,
  pullRequest: ProjectPullRequestSummary | null,
) {
  const meta = SIDEBAR_TABS.find((item) => item.id === tab) ?? SIDEBAR_TABS[0];
  if (tab !== "pr" || !pullRequest) return meta;
  return { ...meta, label: `PR #${pullRequest.number}` };
}

function PullRequestTabSelector({
  project,
  pullRequest,
  active,
  onActivate,
  onSelect,
}: {
  project: ProjectSummary | null;
  pullRequest: ProjectPullRequestSummary | null;
  active: boolean;
  onActivate: () => void;
  onSelect: (number: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pullRequests, setPullRequests] = useState<ProjectPullRequestListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = pullRequest ? `PR #${pullRequest.number}` : "PR";

  const filteredPullRequests = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return pullRequests;
    return pullRequests.filter((item) =>
      [
        `#${item.number}`,
        item.title,
        item.authorLogin,
        item.baseBranch,
        item.headBranch,
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [pullRequests, query]);

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
        if (next) {
          onActivate();
          void loadPullRequests();
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={onActivate}
          className="min-w-0 rounded py-1 pl-0.5 pr-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-pressed={active}
          aria-label={pullRequest ? `Select pull request, current ${label}` : "Select pull request"}
        >
          <span className="block truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-80 overflow-hidden p-0">
        <div className="border-b border-border p-1.5">
          <div className="grid grid-cols-[0.75rem_1fr_auto] items-center gap-1.5 rounded-md bg-background/70 px-1.5 py-1 ring-1 ring-border">
            <Search className="size-3 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pull requests"
              className="min-w-0 bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground"
              aria-label="Search pull requests"
            />
            <button
              type="button"
              onClick={() => void loadPullRequests()}
              disabled={loading}
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
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
        </div>
        <div className="max-h-72 overflow-y-auto p-0.5">
          <div className="px-1.5 py-1 text-[10px] font-medium uppercase text-muted-foreground">
            Pull requests
          </div>
          {error ? (
            <div className="mx-1 rounded-md bg-destructive/10 px-1.5 py-1 text-[11px] text-destructive">
              {error}
            </div>
          ) : filteredPullRequests.length === 0 ? (
            <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              {loading ? "Loading pull requests..." : "No pull requests found."}
            </div>
          ) : (
            <ul className="grid gap-0.5">
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
                      className="grid w-full grid-cols-[0.75rem_minmax(0,1fr)_0.75rem] items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-accent disabled:opacity-60"
                    >
                      {selecting === item.number ? (
                        <Loader2 className="mt-0.5 size-3 animate-spin text-primary" />
                      ) : (
                        <GitBranch
                          className={cn(
                            "mt-0.5 size-3",
                            item.merged
                              ? "text-purple-400"
                              : item.state === "open"
                                ? "text-emerald-400"
                                : "text-muted-foreground",
                          )}
                        />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          #{item.number} {item.title}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">
                          {item.headBranch} {"->"} {item.baseBranch} | {stateLabel} |{" "}
                          {relativePullRequestTime(item.updatedAt)}
                        </span>
                      </span>
                      {selected ? <Check className="mt-0.5 size-3 text-primary" /> : null}
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

function relativePullRequestTime(timestamp: number): string {
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

function EmptyTabsPanel() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
      Add a sidebar tab to view worklog activity, generated plans, todos, or files.
    </div>
  );
}

function WorklogPanel({
  messages,
  onApproval,
}: {
  messages: AntonUIMessage[];
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const entries = getWorklogEntries(messages);
  const latest = entries.at(-1);
  const selected =
    entries.find((entry) => entry.id === selectedId) ?? latest ?? null;

  return (
    <>
      {entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          Tool activity will appear here when Anton reads, searches, edits, or
          runs commands.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ol className="border-b border-border px-2 py-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <WorklogRow
                  entry={entry}
                  active={entry.id === selected?.id}
                  onSelect={() => setSelectedId(entry.id)}
                />
              </li>
            ))}
          </ol>
          {selected && (
            <WorklogDetail entry={selected} onApproval={onApproval} />
          )}
        </div>
      )}
    </>
  );
}
export function getWorklogEntries(messages: AntonUIMessage[]): WorklogEntry[] {
  return getToolTraceEntries(messages);
}

function PlansPanel({ messages }: { messages: AntonUIMessage[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const plans = getPlanMessages(messages);
  const selected = plans.find((plan) => plan.id === selectedId) ?? plans.at(-1);

  if (plans.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
        Generated plans will appear here after using the Plan composer action.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ol className="border-b border-border px-2 py-2">
        {plans.map((plan, index) => (
          <li key={plan.id}>
            <button
              type="button"
              onClick={() => setSelectedId(plan.id)}
              className={cn(
                "grid w-full grid-cols-[0.875rem_1fr] gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors",
                plan.id === selected?.id ? "bg-accent/70" : "hover:bg-accent/40",
              )}
            >
              <FileText className="mt-0.5 size-3 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate font-mono text-[11px] text-foreground">
                  Plan {index + 1}
                </div>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {firstLine(getAssistantTextDisplay(plan).finalText)}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ol>
      {selected && (
        <section className="px-3 py-3">
          <Markdown className="text-xs">
            {getAssistantTextDisplay(selected).finalText}
          </Markdown>
        </section>
      )}
    </div>
  );
}

function TodosPanel({ messages }: { messages: AntonUIMessage[] }) {
  const snapshots = getSessionTodoSnapshots(messages);
  const latest = snapshots.at(-1);

  if (!latest) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
        Todo snapshots will appear here when Anton starts implementation work.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <TodoCard snapshot={latest} compact />
    </div>
  );
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "Markdown plan";
}

function useProjectPullRequest(
  project: ProjectSummary | null,
  options: { enabled: boolean; poll: boolean },
): {
  gitStatus: ProjectGitStatusSummary | null;
  localDiff: ProjectLocalDiffSummary | null;
  pullRequest: ProjectPullRequestSummary | null;
  loading: boolean;
  creating: boolean;
  error: string | null;
  refresh: () => void;
  selectPullRequest: (number: number) => void;
  createPullRequest: () => void;
} {
  const [gitStatus, setGitStatus] = useState<ProjectGitStatusSummary | null>(null);
  const [localDiff, setLocalDiff] = useState<ProjectLocalDiffSummary | null>(null);
  const [pullRequest, setPullRequest] = useState<ProjectPullRequestSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const latestPullRequestRef = useRef<ProjectPullRequestSummary | null>(null);
  const [selectedPullRequest, setSelectedPullRequest] = useState<{
    projectId: string;
    number: number;
  } | null>(null);
  const selectedPullRequestNumber =
    selectedPullRequest !== null && selectedPullRequest.projectId === project?.id
      ? selectedPullRequest.number
      : null;
  const setCurrentPullRequest = useCallback(
    (nextPullRequest: ProjectPullRequestSummary | null) => {
      latestPullRequestRef.current = nextPullRequest;
      setPullRequest(nextPullRequest);
    },
    [],
  );

  useEffect(() => {
    if (
      !options.enabled ||
      !project ||
      project.provider !== "github" ||
      project.status !== "ready"
    ) {
      queueMicrotask(() => {
        setGitStatus(null);
        setLocalDiff(null);
        setCurrentPullRequest(null);
        setError(null);
        setLoading(false);
        setCreating(false);
      });
      return;
    }

    let cancelled = false;
    let loadingRequest = false;
    let pollTimeout: number | null = null;
    const load = async (showLoading: boolean) => {
      if (loadingRequest) return;
      loadingRequest = true;
      if (showLoading) setLoading(true);
      try {
        const statusData = await getJson<{ status: ProjectGitStatusSummary }>(
          `/api/projects/${project.id}/git/status`,
        );
        if (cancelled) return;
        setGitStatus(statusData.status);
        let localDiffError: string | null = null;
        if (statusData.status.dirtyCount > 0) {
          try {
            const diffData = await getJson<{ diff: ProjectLocalDiffSummary }>(
              `/api/projects/${project.id}/git/diff`,
            );
            if (cancelled) return;
            setLocalDiff(diffData.diff);
          } catch (err) {
            if (cancelled) return;
            setLocalDiff(null);
            localDiffError =
              err instanceof Error ? err.message : "Failed to load local diff";
          }
        } else {
          setLocalDiff(null);
        }
        if (selectedPullRequestNumber !== null) {
          let prData: { pullRequest: ProjectPullRequestSummary };
          try {
            prData = await getJson<{
              pullRequest: ProjectPullRequestSummary;
            }>(
              `/api/projects/${project.id}/github/pull-request?number=${selectedPullRequestNumber}`,
            );
          } catch (err) {
            if (cancelled) return;
            setError(errorMessage(err, "Failed to load PR"));
            return;
          }
          if (cancelled) return;
          setCurrentPullRequest(prData.pullRequest);
          setError(localDiffError);
          return;
        }
        if (!statusData.status.branch || statusData.status.isDefaultBranch) {
          setCurrentPullRequest(null);
          setError(localDiffError);
          return;
        }
        let prData: { pullRequest: ProjectPullRequestSummary | null };
        try {
          prData = await getJson<{
            pullRequest: ProjectPullRequestSummary | null;
          }>(
            `/api/projects/${project.id}/github/pull-request?branch=${encodeURIComponent(
              statusData.status.branch,
            )}`,
          );
        } catch (err) {
          if (cancelled) return;
          setError(errorMessage(err, "Failed to load PR"));
          return;
        }
        if (cancelled) return;
        setCurrentPullRequest(prData.pullRequest);
        setError(localDiffError);
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err, "Failed to load PR"));
        }
      } finally {
        loadingRequest = false;
        if (!cancelled) setLoading(false);
      }
    };
    const schedulePoll = () => {
      if (cancelled || !options.poll) return;
      const currentPullRequest = latestPullRequestRef.current;
      if (currentPullRequest === null || currentPullRequest.merged) return;
      pollTimeout = window.setTimeout(() => {
        void load(false).finally(schedulePoll);
      }, PR_POLL_INTERVAL_MS);
    };

    void load(true).finally(schedulePoll);
    const onProjectGitChanged = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        typeof event.detail === "string" &&
        event.detail === project.id
      ) {
        void load(true);
      }
    };
    window.addEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);
    return () => {
      cancelled = true;
      if (pollTimeout !== null) {
        window.clearTimeout(pollTimeout);
      }
      window.removeEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);
    };
  }, [
    options.enabled,
    options.poll,
    project,
    refreshKey,
    selectedPullRequestNumber,
    setCurrentPullRequest,
  ]);

  return {
    gitStatus,
    localDiff,
    pullRequest,
    loading,
    creating,
    error,
    refresh: () => setRefreshKey((current) => current + 1),
    selectPullRequest: (number: number) => {
      if (!project) return;
      setSelectedPullRequest({ projectId: project.id, number });
      setRefreshKey((current) => current + 1);
    },
    createPullRequest: () => {
      if (!project || !gitStatus?.branch || creating) return;
      setCreating(true);
      requestJson<{ pullRequest: ProjectPullRequestSummary }>(
        `/api/projects/${project.id}/github/pull-request`,
        {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ branch: gitStatus.branch }),
        },
      )
        .then((data) => {
          setSelectedPullRequest({
            projectId: project.id,
            number: data.pullRequest.number,
          });
          setCurrentPullRequest(data.pullRequest);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Failed to create PR");
        })
        .finally(() => setCreating(false));
    },
  };
}

function WorklogRow({
  entry,
  active,
  onSelect,
}: {
  entry: WorklogEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const state = toolStateMeta(effectiveToolState(entry));
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid w-full grid-cols-[0.875rem_1fr] gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors",
        active ? "bg-accent/70" : "hover:bg-accent/40",
      )}
      aria-pressed={active}
    >
      <state.Icon
        className={cn("mt-0.5 size-3", state.iconClass)}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-[11px] text-foreground">
            {entry.name}
          </span>
          {state.label.length > 0 && (
            <span className={cn("shrink-0 text-[10px]", state.textClass)}>
              {state.label}
            </span>
          )}
        </div>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {previewToolInput(entry.input)}
        </p>
      </div>
    </button>
  );
}
function WorklogDetail({
  entry,
  onApproval,
}: {
  entry: WorklogEntry;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const state = toolStateMeta(effectiveToolState(entry));
  const showWriteDiff =
    entry.name === "write_file" &&
    entry.state === "output-available" &&
    isOkWriteFileOutput(entry.output) &&
    pickString(entry.input, "content") !== undefined;
  const editOutput = isOkEditFileOutput(entry.output) ? entry.output : undefined;
  const showEditDiff =
    entry.name === "edit_file" &&
    entry.state === "output-available" &&
    typeof editOutput?.previousContent === "string" &&
    typeof editOutput.nextContent === "string";
  const streamToken = pickString(entry.activity?.details, "streamToken");
  const approvalMeta =
    entry.state === "approval-requested"
      ? getApprovalMetadata(entry)
      : undefined;

  return (
    <section className="space-y-2.5 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <state.Icon className={cn("size-3.5", state.iconClass)} />
            {state.label.length > 0 && <span>{state.label}</span>}
          </div>
          <h2 className="mt-0.5 truncate font-mono text-xs font-semibold">
            {entry.name}
          </h2>
        </div>
        {entry.state === "approval-requested" && entry.approvalId && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className="inline-flex items-center justify-center size-6 rounded hover:bg-emerald-500/15"
              title="Approve"
              onClick={() =>
                onApproval({ id: entry.approvalId as string, approved: true })
              }
            >
              <CheckCircle2 className="size-4 text-emerald-400" />
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center size-6 rounded hover:bg-destructive/15"
              title="Deny"
              onClick={() =>
                onApproval({ id: entry.approvalId as string, approved: false })
              }
            >
              <XCircle className="size-4 text-destructive" />
            </button>
          </div>
        )}
        {approvalMeta && (
          <div className="flex flex-wrap items-center gap-1">
            {approvalMeta.riskCategories.map((cat) => {
              const badge = riskCategoryBadge(cat);
              return (
                <span
                  key={cat}
                  className={cn(
                    "rounded px-1.5 py-px font-mono text-[10px] uppercase",
                    badge.baseClass,
                  )}
                >
                  {badge.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {approvalMeta && (
        <ApprovalDetails approval={approvalMeta} />
      )}

      {approvalMeta?.diffPreview && (
        <DiffView
          previous={approvalMeta.diffPreview.previous}
          next={approvalMeta.diffPreview.next}
          newFile={approvalMeta.diffPreview.previous.length === 0}
        />
      )}

      {entry.name !== "bash" && (
        <LogBlock title="Input">{safeStringify(entry.input)}</LogBlock>
      )}

      {showWriteDiff ? (
        <DiffView
          previous={(entry.output as WriteFileOkOutput).previousContent ?? ""}
          next={pickString(entry.input, "content") ?? ""}
          newFile={(entry.output as WriteFileOkOutput).existed === false}
          filename={pickString(entry.input, "path")}
        />
      ) : showEditDiff ? (
        <DiffView
          previous={editOutput?.previousContent ?? ""}
          next={editOutput?.nextContent ?? ""}
          filename={pickString(entry.input, "path")}
        />
      ) : entry.name === "bash" && entry.activity?.status === "running" && entry.activity?.toolCallId ? (
        <LiveTerminalOutput
          command={pickString(entry.input, "command")}
          streamId={entry.activity.toolCallId}
          streamToken={streamToken}
          initialOutput={
            typeof entry.output === "object" && entry.output !== null
              ? (entry.output as {
                  stdout?: string;
                  stderr?: string;
                  exitCode?: number | null;
                  timedOut?: boolean;
                  killed?: boolean;
                  failedReason?: "timeout" | "killed" | "max_buffer" | "error";
                })
              : undefined
          }
        />
      ) : entry.name === "bash" ? (
        <TerminalOutput
          command={pickString(entry.input, "command") ?? safeStringify(entry.input)}
          output={
            entry.state === "output-error" && entry.errorText
              ? { stderr: entry.errorText, exitCode: 1 }
              : entry.output
          }
        />
      ) : entry.state === "output-error" && entry.errorText ? (
        <LogBlock title="Error" tone="error">
          {entry.errorText}
        </LogBlock>
      ) : entry.output !== undefined ? (
        <LogBlock title="Output">{safeStringify(entry.output)}</LogBlock>
      ) : null}
    </section>
  );
}

function LogBlock({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "error";
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div
        className={cn(
          "text-[10px] font-medium uppercase text-muted-foreground",
          tone === "error" && "text-destructive",
        )}
      >
        {title}
      </div>
      <pre className="max-h-56 overflow-auto rounded-md bg-background/70 p-2.5 font-mono text-[10px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  );
}
