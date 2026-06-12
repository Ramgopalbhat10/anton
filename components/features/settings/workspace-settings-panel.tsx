"use client";

import { useState } from "react";
import {
  ArrowRight,
  BookMarked,
  Check,
  Download,
  Folder,
  FolderGit2,
  GitBranch,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import { EmptyState, ErrorBanner } from "@/components/shared/feedback-states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BranchSwitcher } from "@/components/features/projects/branch-switcher";

import { useWorkspaceSettings } from "./hooks";
import { SettingsPageShell } from "./settings-shell";

const REPO_PREVIEW_COUNT = 8;

export function WorkspaceSettingsPanel() {
  const {
    settings,
    rootDraft,
    setRootDraft,
    localPathDraft,
    setLocalPathDraft,
    installations,
    installationFilter,
    setInstallationFilter,
    repositories,
    filteredRepositories,
    readyProjects,
    projectGitStatuses,
    loading,
    saving,
    cloningRepoId,
    importingLocal,
    removingProjectId,
    refreshingProjectId,
    error,
    refresh,
    saveRoot,
    cloneRepo,
    importLocalProject,
    removeProject,
    refreshProject,
  } = useWorkspaceSettings();

  const [repoQuery, setRepoQuery] = useState("");
  const [showAllRepos, setShowAllRepos] = useState(false);

  const query = repoQuery.trim().toLowerCase();
  const searchedRepositories = query
    ? filteredRepositories.filter((repo) =>
        repo.fullName.toLowerCase().includes(query),
      )
    : filteredRepositories;
  const visibleRepositories = showAllRepos
    ? searchedRepositories
    : searchedRepositories.slice(0, REPO_PREVIEW_COUNT);

  return (
    <SettingsPageShell
      title="Workspaces"
      description="Manage where Anton stores cloned repositories and import existing local projects."
    >
      {error && <ErrorBanner message={error} />}

      <section className="overflow-hidden rounded-[10px] border border-border bg-card">
        <div className="flex flex-col gap-4 p-5">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Local workspace root</h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Cloned repositories and new projects are stored under this
              directory.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-input px-3 transition-colors focus-within:border-ring">
              <Folder className="size-3.5 shrink-0 text-muted-foreground/70" />
              <input
                value={rootDraft}
                onChange={(event) => setRootDraft(event.target.value)}
                placeholder="M:\Projects\anton-workspaces"
                aria-label="Local workspace root"
                className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted-foreground/70"
              />
            </label>
            <Button
              type="button"
              onClick={saveRoot}
              disabled={saving || rootDraft.trim().length === 0}
              className="h-[34px] shrink-0 rounded-lg px-4 text-[13px] font-semibold"
            >
              {saving && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </div>
        {settings && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-layout-border px-5 py-3">
            <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground/80">
              Current
              <span className="truncate font-mono text-muted-foreground">
                {settings.resolvedLocalWorkspacesRoot}
              </span>
            </p>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                settings.exists
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  settings.exists ? "bg-success" : "bg-warning",
                )}
              />
              {settings.exists ? "Ready" : "Will be created"}
            </span>
          </div>
        )}
      </section>

      <section className="rounded-[10px] border border-border bg-card">
        <div className="flex flex-col gap-4 p-5">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Import local repository</h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Add an existing Git repository to Anton without copying or
              deleting files.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-input px-3 transition-colors focus-within:border-ring">
              <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground/70" />
              <input
                value={localPathDraft}
                onChange={(event) => setLocalPathDraft(event.target.value)}
                placeholder="M:\Projects\example-repo"
                aria-label="Local repository path"
                className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted-foreground/70"
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void importLocalProject()}
              disabled={importingLocal || localPathDraft.trim().length === 0}
              className="h-[34px] shrink-0 rounded-lg border-border px-3.5 text-[13px] font-medium"
            >
              {importingLocal ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              Import
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold">Projects</h3>
            <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {readyProjects.length}
            </span>
          </div>
          <span className="text-xs text-muted-foreground/80">
            Active in your workspace root
          </span>
        </div>
        <div className="overflow-hidden rounded-[10px] border border-border bg-card">
          {readyProjects.length === 0 ? (
            <div className="p-5">
              <EmptyState message="No projects yet." />
            </div>
          ) : (
            <ul className="divide-y divide-layout-border">
              {readyProjects.map((project) => {
                const currentBranch =
                  projectGitStatuses[project.id]?.branch ?? project.defaultBranch;
                return (
                  <li
                    key={project.id}
                    className="flex items-center gap-3 px-4 py-3.5"
                  >
                    <span className="grid size-[34px] shrink-0 place-items-center rounded-lg border border-border bg-secondary">
                      <FolderGit2 className="size-[15px] text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13px] font-semibold">
                          {project.fullName}
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-[5px] border border-border bg-input px-1.5 py-0.5">
                          <GitBranch className="size-2.5 text-primary" />
                          <span className="max-w-44 truncate font-mono text-[11px] text-primary">
                            {currentBranch}
                          </span>
                        </span>
                      </div>
                      <p className="truncate font-mono text-[11px] text-muted-foreground/80">
                        {project.localPath}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <BranchSwitcher
                        project={project}
                        currentBranch={currentBranch}
                        iconOnly
                        contentAlign="end"
                        onBranchChanged={() => void refresh()}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => void refreshProject(project.id)}
                        disabled={
                          project.provider !== "github" ||
                          refreshingProjectId === project.id
                        }
                        aria-label={
                          project.provider === "github"
                            ? `Refresh metadata for ${project.fullName}`
                            : `Metadata refresh unavailable for ${project.fullName}`
                        }
                        title={
                          project.provider === "github"
                            ? "Refresh GitHub metadata"
                            : "Local projects do not have GitHub metadata"
                        }
                      >
                        {refreshingProjectId === project.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <RefreshCw />
                        )}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            disabled={removingProjectId === project.id}
                            aria-label={`Remove ${project.fullName}`}
                          >
                            {removingProjectId === project.id ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Trash2 />
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove project?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes {project.fullName} from Anton. The
                              local repository files stay on disk.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => void removeProject(project.id)}
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <h3 className="text-[15px] font-semibold">GitHub</h3>
            <p className="text-xs text-muted-foreground/80">
              Clone repositories from your connected accounts
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="h-[33px] rounded-lg border-border px-3 text-[13px] font-medium"
            asChild
          >
            <a href="/api/github/connect">
              <GithubMark className="size-3.5" />
              Connect account
            </a>
          </Button>
        </div>

        {installations.map((installation) => (
          <div
            key={installationKey(installation.installationId)}
            className="flex items-center gap-3 rounded-[10px] border border-border bg-card px-4 py-3.5"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-secondary">
              <GithubMark className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-semibold">
                  {installation.accountLogin}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                  <span className="size-[5px] rounded-full bg-success" />
                  Connected
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground/80">
                {installation.installationId === null
                  ? "Personal access token"
                  : `GitHub App · ${installation.accountType}`}
                {" · "}
                {repositoryCountForInstallation(
                  repositories,
                  installation.installationId,
                )}{" "}
                repositories
              </p>
            </div>
          </div>
        ))}

        <div className="overflow-hidden rounded-[10px] border border-border bg-card">
          {repositories.length === 0 ? (
            <div className="p-5">
              <EmptyState message="Connect GitHub and refresh to list repositories." />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-layout-border px-4 py-3">
                <label className="flex h-[33px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-input px-3 transition-colors focus-within:border-ring">
                  <Search className="size-3.5 shrink-0 text-muted-foreground/70" />
                  <input
                    type="search"
                    value={repoQuery}
                    onChange={(event) => setRepoQuery(event.target.value)}
                    placeholder="Search repositories..."
                    aria-label="Search repositories"
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
                  />
                </label>
                {installations.length > 0 && (
                  <Select
                    value={installationFilter}
                    onValueChange={setInstallationFilter}
                  >
                    <SelectTrigger
                      className="h-[33px] shrink-0 rounded-lg border-border bg-input text-[13px]"
                      aria-label="GitHub account filter"
                    >
                      <SelectValue placeholder="All accounts" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectViewport>
                        <SelectItem value="all">All accounts</SelectItem>
                        {installations.map((installation) => (
                          <SelectItem
                            key={installationKey(installation.installationId)}
                            value={installationKey(installation.installationId)}
                          >
                            {installation.accountLogin}
                          </SelectItem>
                        ))}
                      </SelectViewport>
                    </SelectContent>
                  </Select>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={() => void refresh()}
                  disabled={loading}
                  aria-label="Refresh repositories"
                  className="size-[33px] shrink-0 rounded-lg border-border bg-input"
                >
                  <RefreshCw className={cn(loading && "animate-spin")} />
                </Button>
              </div>

              {searchedRepositories.length === 0 ? (
                <div className="p-5">
                  <EmptyState message="No repositories match." />
                </div>
              ) : (
                <ul className="divide-y divide-layout-border">
                  {visibleRepositories.map((repo) => {
                    const cloning = cloningRepoId === repo.id;
                    const clonePending = repo.cloneStatus === "cloning";
                    const cloned =
                      repo.cloneStatus === "ready" &&
                      repo.clonedProjectId !== null;
                    const cloneFailed = repo.cloneStatus === "error";
                    const [owner, name] = splitFullName(repo.fullName);
                    return (
                      <li
                        key={`${installationKey(repo.installationId)}:${repo.id}`}
                        className="flex items-center gap-3 px-4 py-2.5"
                      >
                        {repo.private ? (
                          <Lock className="size-3.5 shrink-0 text-muted-foreground/70" />
                        ) : (
                          <BookMarked className="size-3.5 shrink-0 text-muted-foreground/70" />
                        )}
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="truncate text-[13px]">
                            <span className="text-muted-foreground/80">
                              {owner}/
                            </span>
                            <span className="font-semibold">{name}</span>
                          </span>
                          <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] font-medium text-muted-foreground/80">
                            {repo.private ? "Private" : "Public"}
                          </span>
                        </div>
                        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground/80 sm:flex">
                          <GitBranch className="size-2.5" />
                          <span className="max-w-32 truncate font-mono">
                            {repo.defaultBranch}
                          </span>
                        </span>
                        {cloned ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                            <Check className="size-3" />
                            Cloned
                          </span>
                        ) : (
                          <span className="flex shrink-0 items-center gap-2">
                            {cloneFailed && (
                              <span
                                className="text-[11px] text-destructive"
                                title={repo.cloneError ?? "Clone failed"}
                              >
                                Failed
                              </span>
                            )}
                            {clonePending && !cloning && (
                              <span className="text-[11px] text-muted-foreground">
                                Pending
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => void cloneRepo(repo)}
                              disabled={cloning}
                              className="inline-flex items-center gap-1.5 rounded-[7px] border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:pointer-events-none disabled:opacity-60"
                            >
                              {cloning ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Download className="size-3" />
                              )}
                              {cloning
                                ? "Cloning"
                                : cloneFailed || clonePending
                                  ? "Retry"
                                  : "Clone"}
                            </button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {searchedRepositories.length > 0 && (
                <div className="flex items-center justify-between border-t border-layout-border px-4 py-3">
                  <span className="text-xs text-muted-foreground/80">
                    Showing {visibleRepositories.length} of{" "}
                    {searchedRepositories.length} repositories
                  </span>
                  {searchedRepositories.length > REPO_PREVIEW_COUNT && (
                    <button
                      type="button"
                      onClick={() => setShowAllRepos((value) => !value)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
                    >
                      {showAllRepos ? "Show less" : "View all"}
                      <ArrowRight className="size-3" />
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </SettingsPageShell>
  );
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function splitFullName(fullName: string): [string, string] {
  const index = fullName.lastIndexOf("/");
  if (index === -1) return ["", fullName];
  return [fullName.slice(0, index), fullName.slice(index + 1)];
}

function repositoryCountForInstallation(
  repositories: { installationId: number | null }[],
  installationId: number | null,
): number {
  return repositories.filter((repo) => repo.installationId === installationId)
    .length;
}

function installationKey(installationId: number | null): string {
  return installationId === null ? "pat" : String(installationId);
}
