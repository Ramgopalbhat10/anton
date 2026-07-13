"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Cpu,
  Folder,
  GitBranch,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

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
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ProjectSummary } from "@/src/lib/api-types";

import { useSessionStore, type SessionSummary } from "./session-store";
import { useProjectBranchOnDemand } from "./use-project-branch-on-demand";

export function SessionRow({
  session,
  isActive,
  project = null,
}: {
  session: SessionSummary;
  isActive: boolean;
  project?: ProjectSummary | null;
}) {
  const { rename, remove } = useSessionStore();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [copiedValue, setCopiedValue] = useState<"branch" | "folder" | null>(
    null,
  );

  const liveBranch = useProjectBranchOnDemand(
    project?.id ?? null,
    hoverOpen,
    Boolean(project?.isGitRepository),
  );

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
    if (isActive) {
      router.replace("/");
    }
    const deleted = await remove(session.id);
    if (!deleted) return;
    if (isActive) {
      router.refresh();
    }
  };

  if (editing) {
    return (
      <li className="flex items-center gap-1 rounded-md bg-sidebar-accent px-2 py-2">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") cancel();
          }}
          className="h-6 flex-1 bg-transparent px-0 focus-visible:ring-0"
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

  const branch = project?.isGitRepository ? liveBranch : null;

  const copy = async (kind: "branch" | "folder", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(kind);
      window.setTimeout(() => setCopiedValue(null), 1_500);
    } catch {
      setCopiedValue(null);
    }
  };

  return (
    <li>
      <HoverCard
        open={hoverOpen}
        onOpenChange={setHoverOpen}
        openDelay={120}
        closeDelay={80}
      >
        <HoverCardTrigger asChild>
          <Link
            href={`/s/${session.id}`}
            className={cn(
              "group relative flex min-w-0 items-start rounded-md px-2 py-[7px] transition-colors duration-150",
              "hover:bg-sidebar-accent/60",
              isActive && "bg-sidebar-accent",
            )}
          >
            <span className="min-w-0 flex-1 pr-0 transition-[padding] group-hover:pr-11 group-focus-within:pr-11">
              <span
                className={cn(
                  "block truncate text-[12.5px] leading-4",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {session.title}
              </span>
              <span className="mt-[3px] block truncate text-[11px] leading-none text-muted-foreground/70">
                {formatRelativeTime(session.updatedAt)}
              </span>
            </span>
            <span className="absolute right-1 top-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setHoverOpen(false);
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
                  setHoverOpen(false);
                  setDeleteOpen(true);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                aria-label="Delete"
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          </Link>
        </HoverCardTrigger>
        <HoverCardContent
          side="right"
          align="start"
          sideOffset={10}
          className="w-[240px] p-0"
        >
          <div className="space-y-2.5 px-3 py-2.5">
            <p className="text-[12.5px] font-medium leading-snug text-foreground">
              {session.title}
            </p>
            <dl className="space-y-1.5 text-[11px]">
              {project ? (
                <>
                  <CopyableMetaRow
                    icon={<GitBranch className="size-3" />}
                    label="Branch"
                    value={branch ?? "—"}
                    copyValue={branch}
                    copied={copiedValue === "branch"}
                    onCopy={() => {
                      if (branch) void copy("branch", branch);
                    }}
                  />
                  <CopyableMetaRow
                    icon={<Folder className="size-3" />}
                    label="Folder"
                    value={project.localPath}
                    copyValue={project.localPath}
                    copied={copiedValue === "folder"}
                    onCopy={() => void copy("folder", project.localPath)}
                  />
                </>
              ) : null}
              <MetaRow
                icon={<Cpu className="size-3" />}
                label="Model"
                value={session.model}
                mono
              />
              <MetaRow
                icon={<Clock3 className="size-3" />}
                label="Updated"
                value={formatRelativeTime(session.updatedAt)}
              />
            </dl>
          </div>
        </HoverCardContent>
      </HoverCard>
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

function MetaRow({
  icon,
  label,
  value,
  mono = false,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      {icon ? (
        <span className="mt-0.5 shrink-0 text-muted-foreground/70">{icon}</span>
      ) : null}
      <div className="min-w-0 flex-1">
        <dt className="sr-only">{label}</dt>
        <dd
          className={cn(
            "truncate text-muted-foreground",
            mono && "font-mono text-[10.5px]",
          )}
          title={value}
        >
          {value}
        </dd>
      </div>
    </div>
  );
}

function CopyableMetaRow({
  icon,
  label,
  value,
  copyValue,
  copied,
  onCopy,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  copyValue: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="group flex min-w-0 items-center gap-1">
      <dt className="sr-only">{label}</dt>
      <span className="shrink-0 text-muted-foreground/70">{icon}</span>
      <dd className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground" title={value}>
        {value}
      </dd>
      {copyValue ? (
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${label.toLowerCase()}`}
          title={`Copy ${label.toLowerCase()}`}
          className="shrink-0 rounded p-0.5 text-muted-foreground/70 opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          {copied ? (
            <CheckCircle2 className="size-3 text-success" />
          ) : (
            <Copy className="size-3" />
          )}
        </button>
      ) : null}
    </div>
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
