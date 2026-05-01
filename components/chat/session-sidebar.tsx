"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Check,
  FolderCog,
  FolderGit2,
  Pencil,
  Plus,
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
import {
  useSessionStore,
  type SessionSummary,
} from "./session-store";
import { ProjectContextDialog } from "./project-context-dialog";
import {
  readActiveProjectId,
  WorkspaceDialog,
} from "./workspace-dialog";

export function SessionSidebar() {
  const { sessions, loading, error } = useSessionStore();
  const params = useParams<{ sessionId?: string }>();
  const activeId = params?.sessionId;
  const [contextOpen, setContextOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    readActiveProjectId(),
  );

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-background/80">
      <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-border">
        <span className="text-sm font-semibold tracking-tight">Anton</span>
        <Button asChild size="sm" variant="outline" className="gap-1 text-xs">
          <Link href="/">
            <Plus />
            New chat
          </Link>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading && sessions.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Loading…
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
          <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            {error}
          </div>
        )}
      </div>
      <div className="border-t border-border p-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs"
          onClick={() => setWorkspaceOpen(true)}
        >
          <FolderGit2 />
          Workspaces
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs"
          onClick={() => setContextOpen(true)}
        >
          <FolderCog />
          Project Context
        </Button>
      </div>
      <ProjectContextDialog open={contextOpen} onOpenChange={setContextOpen} />
      <WorkspaceDialog
        open={workspaceOpen}
        onOpenChange={setWorkspaceOpen}
        activeProjectId={activeProjectId}
        onActiveProjectChange={setActiveProjectId}
      />
    </aside>
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
      <li
        className={cn(
          "flex items-center gap-1 rounded-md px-2 py-1.5",
          "bg-accent/60",
        )}
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") cancel();
          }}
          className="flex-1 min-w-0 bg-transparent text-xs focus:outline-none"
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
          "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs",
          "text-foreground hover:bg-accent",
          isActive && "bg-accent",
        )}
      >
        <span className="flex-1 min-w-0 truncate">{session.title}</span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDraft(session.title);
            setEditing(true);
          }}
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent-foreground/10"
          aria-label="Rename"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDeleteOpen(true);
          }}
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive"
          aria-label="Delete"
        >
          <Trash2 className="size-3.5" />
        </button>
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
