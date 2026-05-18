"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  GitBranch,
  Loader2,
  Plus,
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
  ProjectSummary,
} from "@/src/lib/api-types";
import { errorMessage, getJson, jsonHeaders, requestJson } from "@/src/lib/client-fetch";

import { notifyProjectGitChanged } from "./hooks";

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
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const displayedBranch = currentBranch ?? project?.defaultBranch ?? null;

  const filteredBranches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = branches?.branches ?? [];
    if (!needle) return items;
    return items.filter((branch) => branch.name.toLowerCase().includes(needle));
  }, [branches, query]);

  const loadBranches = async () => {
    if (!project) return;
    setLoading(true);
    try {
      const data = await getJson<{ branches: ProjectBranchesSummary }>(
        `/api/projects/${project.id}/git/branches`,
      );
      setBranches(data.branches);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load branches"));
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadBranches();
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
                  : "No codebase selected"}
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
        <div className="border-b border-border p-2">
          <div className="grid grid-cols-[0.875rem_1fr_auto] items-center gap-2 rounded-md bg-background/70 px-2 py-1.5 ring-1 ring-border">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search branches"
              className="min-w-0 bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground"
              aria-label="Search branches"
            />
            {loading ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
          </div>
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          <div className="px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
            Branches
          </div>
          {error ? (
            <div className="mx-1 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
              {error}
            </div>
          ) : filteredBranches.length === 0 ? (
            <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
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
                    className="grid w-full grid-cols-[0.875rem_minmax(0,1fr)_0.875rem] items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    {switching === branch.name ? (
                      <Loader2 className="size-3.5 animate-spin text-primary" />
                    ) : (
                      <GitBranch className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-mono font-medium">
                        {branch.name}
                      </span>
                      {branch.kind === "remote" ? (
                        <span className="text-[10px] text-muted-foreground">
                          remote
                        </span>
                      ) : null}
                    </span>
                    {branch.current ? (
                      <Check className="size-3.5 text-primary" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-border p-1">
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
                className="h-7 font-mono text-[11px]"
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
              className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3.5" />
              Create and checkout new branch...
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
