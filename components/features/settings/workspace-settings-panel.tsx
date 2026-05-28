"use client";

import {
  Check,
  FolderGit2,
  FolderPlus,
  GitBranch,
  Loader2,
  RefreshCw,
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
import { Input } from "@/components/ui/input";
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
import { SettingsCard, SettingsPageShell } from "./settings-shell";

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
  const showAccountLabels = installations.length > 0;

  return (
    <SettingsPageShell
      title="Workspaces"
      description="Manage where Anton stores cloned repositories and import local projects."
    >
      {error && <ErrorBanner message={error} />}
      <SettingsCard title="Local workspace root" icon={<FolderGit2 />}>
        <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
          <Input
            value={rootDraft}
            onChange={(event) => setRootDraft(event.target.value)}
            className="font-mono"
            placeholder="M:\\Projects\\anton-workspaces"
            aria-label="Local workspace root"
          />
          <Button
            type="button"
            size="sm"
            onClick={saveRoot}
            disabled={saving || rootDraft.trim().length === 0}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            Save
          </Button>
        </div>
        {settings && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Current:{" "}
            <span className="font-mono">{settings.resolvedLocalWorkspacesRoot}</span>
            {" - "}
            {settings.source}
            {settings.exists ? " - ready" : " - will be created"}
          </p>
        )}
      </SettingsCard>

      <SettingsCard title="Import local repository" icon={<FolderPlus />}>
        <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
          <Input
            value={localPathDraft}
            onChange={(event) => setLocalPathDraft(event.target.value)}
            className="font-mono"
            placeholder="M:\\Projects\\example-repo"
            aria-label="Local repository path"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void importLocalProject()}
            disabled={importingLocal || localPathDraft.trim().length === 0}
          >
            {importingLocal ? <Loader2 className="animate-spin" /> : <FolderPlus />}
            Import
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Adds an existing Git repository to Anton without copying or deleting files.
        </p>
      </SettingsCard>

      <SettingsCard title="Projects" icon={<GitBranch />}>
        {readyProjects.length === 0 ? (
          <EmptyState message="No projects yet." />
        ) : (
          <ul className="grid gap-2">
            {readyProjects.map((project) => {
              const currentBranch =
                projectGitStatuses[project.id]?.branch ?? project.defaultBranch;
              return (
                <li
                  key={project.id}
                  className="flex items-start gap-2 rounded-md bg-background/45 p-2.5 ring-1 ring-border"
                >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {project.fullName}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {project.provider === "local" ? "Local" : "GitHub"} -{" "}
                    {currentBranch}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                    {project.localPath}
                  </span>
                </div>
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
                        This removes {project.fullName} from Anton. The local
                        repository files stay on disk.
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
              </li>
              );
            })}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard
        title="GitHub repositories"
        icon={<GitBranch />}
        action={
          <div className="flex items-center gap-1.5">
            <Button type="button" size="sm" variant="outline" asChild>
              <a href="/api/github/connect">Connect GitHub</a>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw className={cn(loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      >
        {repositories.length === 0 ? (
          <EmptyState message="Connect GitHub and refresh to list repositories." />
        ) : (
          <div className="grid gap-3">
            {installations.length > 0 && (
              <div className="grid gap-2 border-b border-border pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium">
                      Connected GitHub accounts
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {installations.length}{" "}
                      {installations.length === 1 ? "installation" : "installations"}
                    </div>
                  </div>
                  <Select
                    value={installationFilter}
                    onValueChange={setInstallationFilter}
                  >
                    <SelectTrigger
                      className="w-[min(220px,70vw)]"
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
                </div>
                <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {installations.map((installation) => (
                    <li key={installationKey(installation.installationId)}>
                      <span className="text-foreground/80">
                        {installation.accountLogin}
                      </span>{" "}
                      - {installation.accountType} -{" "}
                      {repositoryCountForInstallation(
                        repositories,
                        installation.installationId,
                      )}{" "}
                      repos
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {filteredRepositories.length === 0 ? (
              <EmptyState message="No repositories for this account." />
            ) : (
              <ul className="grid gap-2 lg:grid-cols-2">
                {filteredRepositories.map((repo) => (
                  <li
                    key={`${installationKey(repo.installationId)}:${repo.id}`}
                    className="rounded-md bg-background/45 p-2.5 ring-1 ring-border"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">
                          {repo.fullName}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {repo.private ? "Private" : "Public"} -{" "}
                          {repo.defaultBranch}
                          {showAccountLabels
                            ? ` - ${repo.accountLogin} (${repo.accountType})`
                            : ""}
                        </div>
                      </div>
                      {repo.clonedProjectId ? (
                        <span className="text-[11px] text-muted-foreground">
                          Cloned
                        </span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void cloneRepo(repo)}
                          disabled={cloningRepoId === repo.id}
                        >
                          {cloningRepoId === repo.id ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <GitBranch />
                          )}
                          Clone
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </SettingsCard>
    </SettingsPageShell>
  );
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
