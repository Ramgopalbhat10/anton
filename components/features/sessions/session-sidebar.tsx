"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  PanelLeft,
  Plus,
  Settings,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/shared/feedback-states";
import { SearchField } from "@/components/shared/search-field";
import { cn } from "@/lib/utils";
import { SettingsDialog } from "@/components/features/settings/settings-dialog";

import { generateChatId } from "@/components/features/chat/chat-utils";
import { SessionRow } from "./session-row";
import { useSessionStore } from "./session-store";
import { SidebarProvider, useSidebar } from "./sidebar-state";

export { SidebarProvider, useSidebar };

export function SessionSidebar() {
  const { sessions, loading, error, removedSessionIds } = useSessionStore();
  const params = useParams<{ sessionId?: string }>();
  const router = useRouter();
  const activeId = params?.sessionId;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { open, setOpen } = useSidebar();

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
        "hidden shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out md:flex",
        open ? "w-[248px]" : "w-[41px]",
      )}
      data-open={open}
    >
      {open ? (
        <ExpandedSidebar
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
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </aside>
  );
}

function ExpandedSidebar({
  activeId,
  loading,
  error,
  sessions,
  onCollapse,
  onOpenSettings,
  onNewChat,
}: {
  activeId: string | undefined;
  loading: boolean;
  error: string | null;
  sessions: ReturnType<typeof useSessionStore>["sessions"];
  onCollapse: () => void;
  onOpenSettings: () => void;
  onNewChat: () => void;
}) {
  const [query, setQuery] = useState("");
  const filteredSessions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) =>
      session.title.toLowerCase().includes(needle),
    );
  }, [query, sessions]);

  return (
    <div className="flex h-full w-[248px] shrink-0 flex-col">
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
          aria-label="Search recent chats"
          className="rounded-lg bg-input px-2.5 py-2"
          inputClassName="text-[13px]"
        />
      </div>

      <div className="px-5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground/70">
        Recent
      </div>

      <SessionList
        activeId={activeId}
        loading={loading}
        error={error}
        sessions={filteredSessions}
        totalCount={sessions.length}
        query={query}
      />

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
}: {
  activeId: string | undefined;
  loading: boolean;
  error: string | null;
  sessions: ReturnType<typeof useSessionStore>["sessions"];
  totalCount: number;
  query: string;
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


function BrandMark() {
  return (
    <div className="flex items-center justify-center">
      <span className="flex size-[22px] items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
        A
      </span>
    </div>
  );
}
