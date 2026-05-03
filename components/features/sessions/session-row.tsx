"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";

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

export function SessionRow({
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
