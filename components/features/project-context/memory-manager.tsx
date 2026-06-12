"use client";

import { useState } from "react";
import {
  Loader2,
  Pencil,
  Plus,
  Trash2,
  User,
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
import type { ProjectMemory } from "@/src/lib/api-types";
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from "@/components/shared/feedback-states";

import { useMemories } from "./hooks";

const MAX_MEMORY_CHARS = 1000;

export function MemoryManager({
  active,
}: {
  active: boolean;
}) {
  const { memories, loading, saving, error, create, update, remove } =
    useMemories(active);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [memoryToDelete, setMemoryToDelete] = useState<ProjectMemory | null>(
    null,
  );

  const createMemory = async () => {
    const ok = await create(draft);
    if (ok) setDraft("");
  };

  const updateMemory = async (id: string) => {
    const ok = await update(id, editingDraft);
    if (ok) {
      setEditingId(null);
      setEditingDraft("");
    }
  };

  const deleteMemory = async (id: string) => {
    const ok = await remove(id);
    if (ok) setMemoryToDelete(null);
  };

  return (
    <div className="space-y-7">
      {error && <ErrorBanner message={error} />}

      <section className="overflow-hidden rounded-[10px] border border-border bg-card">
        <div className="space-y-2.5 p-4">
          <h3 className="text-sm font-semibold">New memory</h3>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_MEMORY_CHARS}
            placeholder="A durable project preference or fact..."
            aria-label="New memory"
            rows={3}
            className="min-h-[76px] w-full resize-none rounded-lg border border-border bg-input px-3 py-2.5 text-[13px] leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
          />
        </div>
        <div className="flex items-center justify-between border-t border-layout-border px-4 py-2.5">
          <span className="text-[12.5px] text-muted-foreground/80">
            {draft.trim().length} / {MAX_MEMORY_CHARS}
          </span>
          <Button
            type="button"
            onClick={() => void createMemory()}
            disabled={saving || draft.trim().length === 0}
            className="h-[33px] rounded-lg px-3.5 text-[13px] font-semibold"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Add memory
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold">Saved memories</h3>
            <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {memories.length}
            </span>
          </div>
          <span className="text-[12.5px] text-muted-foreground/80">
            Included in every session for this project
          </span>
        </div>

        <div className="overflow-hidden rounded-[10px] border border-border bg-card">
          {loading ? (
            <div className="p-5">
              <LoadingState label="Loading memories" />
            </div>
          ) : memories.length === 0 ? (
            <div className="p-5">
              <EmptyState message="No project memories saved." />
            </div>
          ) : (
            <ul className="divide-y divide-layout-border">
              {memories.map((memory) => {
                const editing = editingId === memory.id;
                return (
                  <li key={memory.id} className="px-4 py-3.5">
                    {editing ? (
                      <div className="space-y-3">
                        <textarea
                          value={editingDraft}
                          onChange={(event) =>
                            setEditingDraft(event.target.value)
                          }
                          maxLength={MAX_MEMORY_CHARS}
                          aria-label="Edit memory"
                          rows={3}
                          className="min-h-[76px] w-full resize-none rounded-lg border border-border bg-input px-3 py-2.5 text-[13px] leading-relaxed outline-none transition-colors focus:border-ring"
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12.5px] text-muted-foreground/80">
                            {editingDraft.trim().length} / {MAX_MEMORY_CHARS}
                          </span>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                setEditingId(null);
                                setEditingDraft("");
                              }}
                              className="h-[33px] rounded-lg border-border px-3 text-[13px]"
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              onClick={() => void updateMemory(memory.id)}
                              disabled={
                                saving || editingDraft.trim().length === 0
                              }
                              className="h-[33px] rounded-lg px-3.5 text-[13px] font-semibold"
                            >
                              {saving && (
                                <Loader2 className="size-3.5 animate-spin" />
                              )}
                              Save
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1 space-y-2">
                          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                            {memory.content}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <MemorySourceBadge />
                            <span className="text-xs text-muted-foreground/80">
                              Added {formatMemoryDate(memory.createdAt)}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(memory.id);
                              setEditingDraft(memory.content);
                            }}
                            aria-label="Edit memory"
                            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setMemoryToDelete(memory)}
                            aria-label="Delete memory"
                            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <AlertDialog
        open={memoryToDelete !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setMemoryToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete memory?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the selected project memory from future Anton
              sessions. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving || memoryToDelete === null}
              onClick={(event) => {
                event.preventDefault();
                if (memoryToDelete) void deleteMemory(memoryToDelete.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MemorySourceBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <User className="size-2.5" />
      Manual
    </span>
  );
}

function formatMemoryDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}
