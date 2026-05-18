"use client";

import { useEffect, useState } from "react";
import type { ChatAddToolApproveResponseFunction } from "ai";
import {
  CheckCircle2,
  FileText,
  GitBranch,
  ListTodo,
  Maximize2,
  Minimize2,
  Plus,
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
import { getJson } from "@/src/lib/client-fetch";
import type {
  ProjectGitStatusSummary,
  ProjectPullRequestSummary,
  ProjectSummary,
} from "@/src/lib/api-types";

export type WorklogEntry = ToolTraceEntry;
type SidebarTab = "worklog" | "plans" | "todos" | "pr";

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
  const prState = useProjectPullRequest(project);
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
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className="min-w-0 rounded py-1 pl-0.5 pr-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-pressed={activeTab === tab}
                  >
                    <span className="block truncate">{meta.label}</span>
                  </button>
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
        ) : activeTab === "pr" && prState.pullRequest ? (
          <PullRequestPanel
            pullRequest={prState.pullRequest}
            gitStatus={prState.gitStatus}
            loading={prState.loading}
            error={prState.error}
            onRefresh={prState.refresh}
          />
        ) : activeTab === "pr" && hasGithubProject ? (
          <PullRequestEmptyPanel
            gitStatus={prState.gitStatus}
            loading={prState.loading}
            error={prState.error}
            onRefresh={prState.refresh}
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
] as const satisfies readonly {
  id: SidebarTab;
  label: string;
  Icon: typeof TerminalSquare;
}[];

function tabMeta(
  tab: SidebarTab,
  pullRequest: ProjectPullRequestSummary | null,
) {
  const meta = SIDEBAR_TABS.find((item) => item.id === tab) ?? SIDEBAR_TABS[0];
  if (tab !== "pr" || !pullRequest) return meta;
  return { ...meta, label: `PR #${pullRequest.number}` };
}

function EmptyTabsPanel() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
      Add a sidebar tab to view worklog activity, generated plans, or todos.
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

function useProjectPullRequest(project: ProjectSummary | null): {
  gitStatus: ProjectGitStatusSummary | null;
  pullRequest: ProjectPullRequestSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [gitStatus, setGitStatus] = useState<ProjectGitStatusSummary | null>(null);
  const [pullRequest, setPullRequest] = useState<ProjectPullRequestSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (
      !project ||
      project.provider !== "github" ||
      project.status !== "ready"
    ) {
      queueMicrotask(() => {
        setGitStatus(null);
        setPullRequest(null);
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
          `/api/projects/${project.id}/git/status`,
        );
        if (cancelled) return;
        setGitStatus(statusData.status);
        if (!statusData.status.branch || statusData.status.isDefaultBranch) {
          setPullRequest(null);
          setError(null);
          return;
        }
        const prData = await getJson<{
          pullRequest: ProjectPullRequestSummary | null;
        }>(
          `/api/projects/${project.id}/github/pull-request?branch=${encodeURIComponent(
            statusData.status.branch,
          )}`,
        );
        if (cancelled) return;
        setPullRequest(prData.pullRequest);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setPullRequest(null);
          setError(err instanceof Error ? err.message : "Failed to load PR");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load(true);
    const interval = window.setInterval(() => void load(false), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [project, refreshKey]);

  return {
    gitStatus,
    pullRequest,
    loading,
    error,
    refresh: () => setRefreshKey((current) => current + 1),
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
        />
      ) : showEditDiff ? (
        <DiffView
          previous={editOutput?.previousContent ?? ""}
          next={editOutput?.nextContent ?? ""}
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
