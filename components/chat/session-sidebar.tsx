"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  MessageSquare,
  PanelLeftClose,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useSessionStore, type SessionSummary } from "./session-store";
import { SettingsDialog } from "./settings-dialog";
import { readActiveProjectId } from "./active-project";

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const value = useMemo(
    () => ({
      open,
      setOpen,
      toggle: () => setOpen((next) => !next),
    }),
    [open],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return value;
}

export function SessionSidebar() {
  const { sessions, loading, error } = useSessionStore();
  const params = useParams<{ sessionId?: string }>();
  const activeId = params?.sessionId;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { open, setOpen } = useSidebar();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    readActiveProjectId(),
  );

  return (
    <aside
      className={cn(
        "hidden shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out md:flex",
        open ? "w-[300px]" : "w-[41px]",
      )}
      data-open={open}
    >
      {open ? (
        <div className="flex h-full w-[300px] shrink-0 flex-col">
          <div className="grid h-10 grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-1 pl-2 pr-2">
            <div className="flex items-center justify-center">
              <span className="flex size-5 items-center justify-center rounded bg-secondary text-[11px] font-semibold text-muted-foreground">
                A
              </span>
            </div>
            <div className="flex min-w-0 items-center">
              <span className="truncate text-xs font-semibold tracking-tight">
                Anton
              </span>
            </div>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => setOpen(false)}
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
            <span className="text-xs font-medium text-muted-foreground">
              Recent
            </span>
            <Button asChild size="icon-sm" variant="ghost" aria-label="New chat">
              <Link href="/">
                <Plus />
              </Link>
            </Button>
          </div>

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
              {sessions.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  isActive={s.id === activeId}
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

          <div className="border-t border-sidebar-border p-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
            >
              <Settings />
              Settings
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex h-full w-[41px] shrink-0 flex-col">
          <div className="flex h-10 w-full items-center pl-2">
            <span className="flex size-5 items-center justify-center rounded bg-secondary text-[11px] font-semibold text-muted-foreground">
              A
            </span>
          </div>
          <nav className="flex w-full flex-col gap-1 pl-2">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="bg-sidebar-accent text-sidebar-accent-foreground"
              aria-label="Sessions"
            >
              <MessageSquare />
            </Button>
            <Button asChild size="icon-sm" variant="ghost" aria-label="New chat">
              <Link href="/">
                <Plus />
              </Link>
            </Button>
          </nav>
          <div className="mt-auto w-full border-t border-sidebar-border py-1.5 pl-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
            >
              <Settings />
            </Button>
          </div>
        </div>
      )}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        activeProjectId={activeProjectId}
        onActiveProjectChange={setActiveProjectId}
      />
    </aside>
  );
}

function SidebarNavItem({
  active,
  icon,
  children,
}: {
  active?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
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

function SessionRow({
  session,
  isActive,
}: {
  session: SessionSummary;
  isActive: boolean;
}) {
  const { rename, remove } = useSessionStore();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const commit = async () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== session.title) {
      await rename(session.id, trimmed);
    } else {
      setDraft(session.title);
    }
  };

  const cancel = () => {
    setDraft(session.title);
    setEditing(false);
  };

  const onDelete = async () => {
    await remove(session.id);
    if (isActive) router.push("/");
  };

  if (editing) {
    return (
      <li className="flex items-center gap-1 rounded-md bg-sidebar-accent px-2 py-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") cancel();
          }}
          className="min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
        />
        <button
          type="button"
          onClick={commit}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Save"
        >
          <Check className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={cancel}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Cancel"
        >
          <X className="size-3.5" />
        </button>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={`/s/${session.id}`}
        className={cn(
          "group relative flex min-w-0 items-start rounded-md px-2 py-1.5 text-xs",
          "text-foreground hover:bg-sidebar-accent/70",
          isActive && "bg-sidebar-accent",
        )}
      >
        <span className="min-w-0 flex-1 pr-0 transition-[padding] group-hover:pr-11 group-focus-within:pr-11">
          <span className="block truncate font-medium">{session.title}</span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {formatRelativeTime(session.updatedAt)}
          </span>
        </span>
        <span className="absolute right-1 top-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDraft(session.title);
              setEditing(true);
            }}
            className="rounded p-1 text-muted-foreground hover:bg-accent-foreground/10 hover:text-foreground"
            aria-label="Rename"
          >
            <Pencil className="size-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDeleteOpen(true);
            }}
            className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            aria-label="Delete"
          >
            <Trash2 className="size-3" />
          </button>
        </span>
      </Link>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the chat session and its messages. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void onDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function formatRelativeTime(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (deltaMs < minute) return "just now";
  if (deltaMs < hour) return `${Math.floor(deltaMs / minute)} minutes ago`;
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)} hours ago`;
  return `${Math.floor(deltaMs / day)} days ago`;
}
