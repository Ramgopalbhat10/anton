"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  MessageSquare,
  PanelLeftClose,
  Plus,
  Settings,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
        open ? "w-[300px]" : "w-[41px]",
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
  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col">
      <div className="flex h-10 items-center justify-between px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <BrandMark />
          <span className="truncate text-xs font-semibold tracking-tight">
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
          <PanelLeftClose />
        </Button>
      </div>

      <nav className="space-y-0.5 px-2 pb-2">
        <SidebarNavItem active icon={<MessageSquare />}>
          Sessions
        </SidebarNavItem>
      </nav>

      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Recent</span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="New chat"
          onClick={onNewChat}
        >
          <Plus />
        </Button>
      </div>

      <SessionList
        activeId={activeId}
        loading={loading}
        error={error}
        sessions={sessions}
      />

      <div className="border-t border-sidebar-border p-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <Settings />
          Settings
        </Button>
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
      <nav className="flex w-full flex-col items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="bg-sidebar-accent text-sidebar-accent-foreground"
          aria-label="Sessions"
        >
          <MessageSquare />
        </Button>
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
}: {
  activeId: string | undefined;
  loading: boolean;
  error: string | null;
  sessions: ReturnType<typeof useSessionStore>["sessions"];
}) {
  return (
    <div className="flex-1 overflow-y-auto pb-2">
      {loading && sessions.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          Loading...
        </div>
      ) : sessions.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          No sessions yet. Send a message to start one.
        </div>
      ) : (
        <ul className="space-y-0.5 px-2">
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
        <div className="mx-3 mt-2 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive ring-1 ring-destructive/30">
          {error}
        </div>
      )}
    </div>
  );
}

function SidebarNavItem({
  active,
  icon,
  children,
}: {
  active?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
    >
      <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>
      <span>{children}</span>
    </button>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center justify-center">
      <span className="flex size-5 items-center justify-center rounded bg-secondary text-[11px] font-semibold text-muted-foreground">
        A
      </span>
    </div>
  );
}
