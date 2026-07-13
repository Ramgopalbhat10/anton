"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderTree,
  List,
  PanelLeft,
  Plus,
  Settings,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/shared/feedback-states";
import { SearchField } from "@/components/shared/search-field";
import { cn } from "@/lib/utils";
import { SettingsDialog } from "@/components/features/settings/settings-dialog";
import { useProjectsList } from "@/components/features/projects/hooks";
import type { ProjectSummary } from "@/src/lib/api-types";

import { generateChatId } from "@/components/features/chat/chat-utils";
import {
  groupSessionsByProject,
  readSessionViewMode,
  SESSION_GROUP_PREVIEW_COUNT,
  writeSessionViewMode,
  type SessionViewMode,
} from "./session-groups";
import { SessionRow } from "./session-row";
import { useSessionStore, type SessionSummary } from "./session-store";
import { SidebarProvider, useSidebar } from "./sidebar-state";
import { useSidebarWidth } from "./use-sidebar-width";

export { SidebarProvider, useSidebar };

export function SessionSidebar() {
  const { sessions, loading, error, removedSessionIds } = useSessionStore();
  const params = useParams<{ sessionId?: string }>();
  const router = useRouter();
  const activeId = params?.sessionId;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { open, setOpen } = useSidebar();
  const { width, isResizing, startResize } = useSidebarWidth();

  useEffect(() => {
    if (!activeId || loading || error) return;
    const activeSessionMissing = !sessions.some(
      (session) => session.id === activeId,
    );
    if (!removedSessionIds.has(activeId) && !activeSessionMissing) return;
    router.replace("/");
    router.refresh();
  }, [activeId, error, loading, removedSessionIds, router, sessions]);

  return (
    <aside
      className={cn(
        "relative hidden shrink-0 overflow-visible border-r border-sidebar-border bg-sidebar md:flex",
        !isResizing && "transition-[width] duration-200 ease-out",
      )}
      style={{ width: open ? width : 41 }}
      data-open={open}
    >
      {open ? (
        <ExpandedSidebar
          width={width}
          activeId={activeId}
          loading={loading}
          error={error}
          sessions={sessions}
          onCollapse={() => setOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onNewChat={() => router.push(`/?chat=${generateChatId()}`)}
        />
      ) : (
        <CollapsedSidebar
          onOpenSettings={() => setSettingsOpen(true)}
          onNewChat={() => router.push(`/?chat=${generateChatId()}`)}
        />
      )}
      {open ? (
        <button
          type="button"
          aria-label="Resize sidebar"
          title="Drag to resize"
          onMouseDown={(event) => {
            event.preventDefault();
            startResize(event.clientX);
          }}
          className={cn(
            "absolute top-0 right-0 z-20 h-full w-1.5 translate-x-1/2 cursor-col-resize border-0 bg-transparent p-0",
            "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border/80 before:transition-colors",
            "hover:before:bg-ring/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isResizing && "before:bg-ring",
          )}
        />
      ) : null}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </aside>
  );
}

function ExpandedSidebar({
  width,
  activeId,
  loading,
  error,
  sessions,
  onCollapse,
  onOpenSettings,
  onNewChat,
}: {
  width: number;
  activeId: string | undefined;
  loading: boolean;
  error: string | null;
  sessions: SessionSummary[];
  onCollapse: () => void;
  onOpenSettings: () => void;
  onNewChat: () => void;
}) {
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<SessionViewMode>("recent");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const { projects } = useProjectsList();

  useEffect(() => {
    // Hydrate persisted view mode after mount (SSR-safe).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewMode(readSessionViewMode());
  }, []);

  const projectsById = useMemo(() => {
    const map = new Map<string, ProjectSummary>();
    for (const project of projects) {
      map.set(project.id, project);
    }
    return map;
  }, [projects]);

  const filteredSessions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) =>
      session.title.toLowerCase().includes(needle),
    );
  }, [query, sessions]);

  const sessionGroups = useMemo(
    () => groupSessionsByProject(filteredSessions, projects),
    [filteredSessions, projects],
  );

  const setMode = (mode: SessionViewMode) => {
    setViewMode(mode);
    writeSessionViewMode(mode);
  };

  const toggleView = () => {
    setMode(viewMode === "recent" ? "projects" : "recent");
  };

  const showMore = (groupId: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      next.add(groupId);
      return next;
    });
  };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full shrink-0 flex-col overflow-hidden" style={{ width }}>
      <div className="flex items-center justify-between py-2.5 pl-3.5 pr-2">
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark />
          <span className="truncate text-[13.5px] font-semibold tracking-tight">
            Anton
          </span>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onCollapse}
          aria-label="Collapse sidebar"
        >
          <PanelLeft className="text-muted-foreground/70" />
        </Button>
      </div>

      <div className="flex flex-col gap-2.5 px-3 pt-0.5">
        <button
          type="button"
          onClick={onNewChat}
          className="flex h-[34px] w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary text-[13px] font-medium transition-colors hover:bg-secondary/80"
        >
          <Plus className="size-[13px]" />
          New chat
        </button>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search chats..."
          aria-label="Search chats"
          className="rounded-lg bg-input px-2.5 py-2"
          inputClassName="text-[13px]"
        />
      </div>

      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
        <span className="px-2 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground/70">
          {viewMode === "recent" ? "Recent" : "Projects"}
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-6"
          onClick={toggleView}
          aria-label={
            viewMode === "recent"
              ? "Switch to projects view"
              : "Switch to recent view"
          }
          aria-pressed={viewMode === "projects"}
        >
          {viewMode === "recent" ? (
            <FolderTree className="size-3.5 text-muted-foreground/70" />
          ) : (
            <List className="size-3.5 text-muted-foreground/70" />
          )}
        </Button>
      </div>

      {viewMode === "recent" ? (
        <SessionList
          activeId={activeId}
          loading={loading}
          error={error}
          sessions={filteredSessions}
          totalCount={sessions.length}
          query={query}
          projectsById={projectsById}
        />
      ) : (
        <GroupedSessionList
          activeId={activeId}
          loading={loading}
          error={error}
          groups={sessionGroups}
          totalCount={sessions.length}
          query={query}
          expandedGroups={expandedGroups}
          onShowMore={showMore}
          collapsedGroups={collapsedGroups}
          onToggleGroup={toggleGroup}
        />
      )}

      <div className="border-t border-layout-border">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Settings"
        >
          <Settings className="size-3.5 text-muted-foreground/70" />
          Settings
        </button>
      </div>
    </div>
  );
}

function CollapsedSidebar({
  onOpenSettings,
  onNewChat,
}: {
  onOpenSettings: () => void;
  onNewChat: () => void;
}) {
  return (
    <div className="flex h-full w-[41px] shrink-0 flex-col">
      <div className="flex h-10 w-full items-center justify-center">
        <BrandMark />
      </div>
      <nav className="flex w-full flex-col items-center gap-1 px-1 pt-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="New chat"
          onClick={onNewChat}
        >
          <Plus className="size-3.5" />
        </Button>
      </nav>
      <div className="mt-auto flex w-full justify-center border-t border-sidebar-border py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <Settings className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function SessionList({
  activeId,
  loading,
  error,
  sessions,
  totalCount,
  query,
  projectsById,
}: {
  activeId: string | undefined;
  loading: boolean;
  error: string | null;
  sessions: SessionSummary[];
  totalCount: number;
  query: string;
  projectsById: Map<string, ProjectSummary>;
}) {
  return (
    <div className="flex-1 overflow-y-auto pb-2">
      {loading && totalCount === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          Loading...
        </div>
      ) : totalCount === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          No sessions yet. Send a message to start one.
        </div>
      ) : sessions.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          No chats match &ldquo;{query.trim()}&rdquo;.
        </div>
      ) : (
        <ul className="space-y-0.5 px-3">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              isActive={session.id === activeId}
              project={
                session.projectId
                  ? projectsById.get(session.projectId) ?? null
                  : null
              }
            />
          ))}
        </ul>
      )}
      {error && (
        <div className="mx-3 mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
    </div>
  );
}

function GroupedSessionList({
  activeId,
  loading,
  error,
  groups,
  totalCount,
  query,
  expandedGroups,
  onShowMore,
  collapsedGroups,
  onToggleGroup,
}: {
  activeId: string | undefined;
  loading: boolean;
  error: string | null;
  groups: ReturnType<typeof groupSessionsByProject>;
  totalCount: number;
  query: string;
  expandedGroups: Set<string>;
  onShowMore: (groupId: string) => void;
  collapsedGroups: Set<string>;
  onToggleGroup: (groupId: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto pb-2">
      {loading && totalCount === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          Loading...
        </div>
      ) : totalCount === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          No sessions yet. Send a message to start one.
        </div>
      ) : groups.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          No chats match &ldquo;{query.trim()}&rdquo;.
        </div>
      ) : (
        <div className="space-y-1 px-3">
          {groups.map((group) => {
            const expanded = expandedGroups.has(group.id);
            const collapsed = collapsedGroups.has(group.id);
            const visibleSessions = expanded
              ? group.sessions
              : group.sessions.slice(0, SESSION_GROUP_PREVIEW_COUNT);
            const hiddenCount = group.sessions.length - visibleSessions.length;

            return (
              <div key={group.id} className="space-y-1">
                <button
                  type="button"
                  onClick={() => onToggleGroup(group.id)}
                  aria-expanded={!collapsed}
                  className="group flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-sidebar-accent/60"
                >
                  <span className="relative grid size-3 shrink-0 place-items-center text-muted-foreground/70">
                    <Folder className="size-3 transition-opacity group-hover:opacity-0" />
                    {collapsed ? (
                      <ChevronRight className="absolute size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    ) : (
                      <ChevronDown className="absolute size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    )}
                  </span>
                  <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
                    {group.label}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">
                    {group.sessions.length}
                  </span>
                </button>
                {!collapsed ? (
                  <ul className="space-y-0.5">
                    {visibleSessions.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        isActive={session.id === activeId}
                        project={group.project}
                      />
                    ))}
                  </ul>
                ) : null}
                {!collapsed && hiddenCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => onShowMore(group.id)}
                    className="px-2 py-1 text-[11px] text-muted-foreground/80 transition-colors hover:text-foreground"
                  >
                    More
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {error && (
        <div className="mx-3 mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
    </div>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center justify-center">
      <span className="flex size-[22px] items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
        A
      </span>
    </div>
  );
}
