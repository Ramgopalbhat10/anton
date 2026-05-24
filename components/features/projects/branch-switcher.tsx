"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleDot,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  ProjectBranchesSummary,
  ProjectBranchSummary,
  ProjectIssueSummary,
  ProjectSummary,
} from "@/src/lib/api-types";
import { errorMessage, getJson, jsonHeaders, requestJson } from "@/src/lib/client-fetch";

import { PopupSectionHeader } from "@/components/shared/popup-section-header";
import {
  PopupSortSelect,
  type PopupSortOption,
} from "@/components/shared/popup-sort-select";

import { notifyProjectGitChanged } from "./hooks";

type BranchSort =
  | "recent-desc"
  | "recent-asc"
  | "name-asc"
  | "name-desc"
  | "local-first"
  | "remote-first";

const BRANCH_SORT_OPTIONS = [
  { value: "recent-desc", label: "Recent" },
  { value: "recent-asc", label: "Oldest" },
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
  { value: "local-first", label: "Local first" },
  { value: "remote-first", label: "Remote first" },
] as const satisfies readonly PopupSortOption<BranchSort>[];

function branchCommitTime(branch: ProjectBranchSummary): number {
  return branch.lastCommitAt ?? 0;
}

function sortBranches(
  branches: ProjectBranchSummary[],
  sort: BranchSort,
): ProjectBranchSummary[] {
  const sorted = [...branches];
  switch (sort) {
    case "recent-desc":
      sorted.sort(
        (a, b) => branchCommitTime(b) - branchCommitTime(a) || a.name.localeCompare(b.name),
      );
      break;
    case "recent-asc":
      sorted.sort(
        (a, b) => branchCommitTime(a) - branchCommitTime(b) || a.name.localeCompare(b.name),
      );
      break;
    case "name-asc":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "name-desc":
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "local-first":
      sorted.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "local" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      break;
    case "remote-first":
      sorted.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "remote" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      break;
  }

  const current = sorted.find((branch) => branch.current);
  if (!current) return sorted;
  return [current, ...sorted.filter((branch) => !branch.current)];
}

function relativeBranchTime(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return "Unknown";
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

export function BranchSwitcher({
  project,
  currentBranch,
  className,
  triggerClassName,
  contentAlign = "center",
  showProjectName = true,
  iconOnly = false,
  onBranchChanged,
}: {
  project: ProjectSummary | null;
  currentBranch: string | null;
  className?: string;
  triggerClassName?: string;
  contentAlign?: "start" | "center" | "end";
  showProjectName?: boolean;
  iconOnly?: boolean;
  onBranchChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [branches, setBranches] = useState<ProjectBranchesSummary | null>(null);
  const [issues, setIssues] = useState<ProjectIssueSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [branchSort, setBranchSort] = useState<BranchSort>("recent-desc");
  const displayedBranch = currentBranch ?? project?.defaultBranch ?? null;

  const filteredBranches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = branches?.branches ?? [];
    const filtered = needle
      ? items.filter((branch) => branch.name.toLowerCase().includes(needle))
      : items;
    return sortBranches(filtered, branchSort);
  }, [branches, branchSort, query]);

  const filteredIssues = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return issues;
    return issues.filter((issue) =>
      [
        `#${issue.number}`,
        issue.title,
        issue.suggestedBranchName,
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [issues, query]);

  const loadBranches = useCallback(async ({ refresh = false } = {}) => {
    if (!project) return;
    setLoading(true);
    try {
      const queryString = refresh ? "?refresh=1" : "";
      const branchData = await getJson<{ branches: ProjectBranchesSummary }>(
        `/api/projects/${project.id}/git/branches${queryString}`,
      );
      setBranches(branchData.branches);
      setError(null);
      if (project.provider === "github" && project.status === "ready") {
        try {
          const issueData = await getJson<{ issues: ProjectIssueSummary[] }>(
            `/api/projects/${project.id}/github/issues`,
          );
          setIssues(issueData.issues);
          setIssueError(null);
        } catch (err) {
          setIssues([]);
          setIssueError(errorMessage(err, "Failed to load issues"));
        }
      } else {
        setIssues([]);
        setIssueError(null);
      }
    } catch (err) {
      setError(errorMessage(err, "Failed to load branches"));
    } finally {
      setLoading(false);
    }
  }, [project]);

  const mutateBranch = async (body: Record<string, unknown>, busyLabel: string) => {
    if (!project) return;
    setSwitching(busyLabel);
    setCreating(body.action === "create");
    try {
      const data = await requestJson<{ branches: ProjectBranchesSummary }>(
        `/api/projects/${project.id}/git/branches`,
        {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify(body),
        },
      );
      setBranches(data.branches);
      setCreateMode(false);
      setNewBranch("");
      setError(null);
      notifyProjectGitChanged(project.id);
      onBranchChanged?.();
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, "Branch operation failed"));
    } finally {
      setSwitching(null);
      setCreating(false);
    }
  };

  const selectBranch = (branch: ProjectBranchSummary) => {
    if (branch.current) {
      setOpen(false);
      return;
    }
    void mutateBranch(
      { action: "switch", branch: branch.name, kind: branch.kind },
      branch.name,
    );
  };

  const createBranch = () => {
    const trimmed = newBranch.trim();
    if (!trimmed) return;
    void mutateBranch({ action: "create", branch: trimmed }, trimmed);
  };

  const selectIssue = (issue: ProjectIssueSummary) => {
    const local = branches?.branches.find(
      (branch) => branch.name === issue.suggestedBranchName,
    );
    if (local) {
      selectBranch(local);
      return;
    }
    const remote = branches?.branches.find(
      (branch) => branch.name === `origin/${issue.suggestedBranchName}`,
    );
    if (remote) {
      selectBranch(remote);
      return;
    }
    void mutateBranch(
      { action: "create", branch: issue.suggestedBranchName },
      issue.suggestedBranchName,
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadBranches({ refresh: true });
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!project}
          className={cn(
            iconOnly
              ? "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              : "inline-flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
            triggerClassName,
          )}
          aria-label={
            project && displayedBranch
              ? `Switch branch for ${project.fullName}, current branch ${displayedBranch}`
              : "Switch branch"
          }
          title={
            project && displayedBranch
              ? `${project.fullName} : ${displayedBranch}`
              : undefined
          }
        >
          <GitBranch className="size-3.5 shrink-0" />
          {!iconOnly && (
            <>
              <span className={cn("truncate", className)}>
                {project && displayedBranch
                  ? showProjectName
                    ? `${project.fullName} : ${displayedBranch}`
                    : displayedBranch
                  : "branch"}
              </span>
              <ChevronDown className="size-3 shrink-0" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={contentAlign}
        side="top"
        className="w-72 overflow-hidden p-0"
      >
        <div className="border-b border-border p-1.5">
          <div className="grid grid-cols-[0.75rem_1fr_auto] items-center gap-1.5 rounded-md bg-background/70 px-1.5 py-1 ring-1 ring-border">
            <Search className="size-3 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search branches"
              className="min-w-0 bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground"
              aria-label="Search branches"
            />
            <button
              type="button"
              onClick={() => void loadBranches({ refresh: true })}
              disabled={loading || switching !== null}
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
              aria-label="Refresh branches"
              title="Refresh branches"
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
          <PopupSectionHeader
            title="Branches"
            action={
              <PopupSortSelect
                value={branchSort}
                options={BRANCH_SORT_OPTIONS}
                onChange={setBranchSort}
                aria-label="Sort branches"
              />
            }
          />
          {error ? (
            <div className="mx-1 rounded-md bg-destructive/10 px-1.5 py-1 text-[11px] text-destructive">
              {error}
            </div>
          ) : filteredBranches.length === 0 ? (
            <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              {loading ? "Loading branches..." : "No branches found."}
            </div>
          ) : (
            <ul className="grid gap-0.5">
              {filteredBranches.map((branch) => (
                <li key={`${branch.kind}:${branch.name}`}>
                  <button
                    type="button"
                    onClick={() => selectBranch(branch)}
                    disabled={switching !== null}
                    className="grid w-full grid-cols-[0.75rem_minmax(0,1fr)_0.75rem] items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    {switching === branch.name ? (
                      <Loader2 className="mt-0.5 size-3 animate-spin text-primary" />
                    ) : (
                      <GitBranch
                        className={cn(
                          "mt-0.5 size-3",
                          branch.kind === "remote"
                            ? "text-sky-400"
                            : "text-muted-foreground",
                        )}
                        aria-label={branch.kind === "remote" ? "Remote branch" : "Local branch"}
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-mono font-medium">
                        {branch.name}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {branch.kind === "remote" ? "remote" : "local"}
                        {branch.lastCommitAt !== null
                          ? ` · ${relativeBranchTime(branch.lastCommitAt)}`
                          : null}
                      </span>
                    </span>
                    {branch.current ? (
                      <Check className="size-3 text-primary" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {project?.provider === "github" ? (
            <>
              <div className="mt-1 border-t border-border px-1.5 py-1 text-[10px] font-medium uppercase text-muted-foreground">
                Issues
              </div>
              {issueError ? (
                <div className="mx-1 rounded-md bg-destructive/10 px-1.5 py-1 text-[11px] text-destructive">
                  {issueError}
                </div>
              ) : filteredIssues.length === 0 ? (
                <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                  {loading ? "Loading issues..." : "No open issues found."}
                </div>
              ) : (
                <ul className="grid gap-0.5">
                  {filteredIssues.map((issue) => (
                    <li key={issue.number}>
                      <button
                        type="button"
                        onClick={() => selectIssue(issue)}
                        disabled={switching !== null}
                        className="grid w-full grid-cols-[0.75rem_minmax(0,1fr)] items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-accent disabled:opacity-60"
                      >
                        {switching === issue.suggestedBranchName ? (
                          <Loader2 className="mt-0.5 size-3 animate-spin text-primary" />
                        ) : (
                          <CircleDot className="mt-0.5 size-3 text-emerald-400" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            #{issue.number} {issue.title}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">
                            {issue.suggestedBranchName}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>
        <div className="border-t border-border p-0.5">
          {createMode ? (
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-1">
              <Input
                value={newBranch}
                onChange={(event) => setNewBranch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    createBranch();
                  }
                  if (event.key === "Escape") {
                    setCreateMode(false);
                    setNewBranch("");
                  }
                }}
                className="h-6 font-mono text-[11px]"
                placeholder="codex/new-branch"
                aria-label="New branch name"
                autoFocus
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={createBranch}
                disabled={creating || newBranch.trim().length === 0}
                aria-label="Create and checkout branch"
              >
                {creating ? <Loader2 className="animate-spin" /> : <Check />}
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  setCreateMode(false);
                  setNewBranch("");
                }}
                disabled={creating}
                aria-label="Cancel new branch"
              >
                <X />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreateMode(true)}
              className="flex h-6 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3" />
              Create and checkout new branch...
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
