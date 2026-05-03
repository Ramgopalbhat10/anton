"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import type { ProjectMemory } from "@/src/lib/api-types";
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from "@/components/shared/feedback-states";

import { useMemories } from "./hooks";

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
    <>
      {error && <ErrorBanner message={error} />}
      <MemorySection title="New memory">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={1000}
          placeholder="A durable project preference or fact."
          className="min-h-16 resize-none text-xs"
          aria-label="New memory"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {draft.trim().length}/1000
          </span>
          <Button
            type="button"
            size="sm"
            onClick={() => void createMemory()}
            disabled={saving || draft.trim().length === 0}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Plus />}
            Add memory
          </Button>
        </div>
      </MemorySection>

      <MemorySection title="Saved memories">
        {loading ? (
          <LoadingState label="Loading memories" />
        ) : memories.length === 0 ? (
          <EmptyState message="No project memories saved." />
        ) : (
          <ul className="space-y-1.5">
            {memories.map((memory) => {
              const editing = editingId === memory.id;
              return (
                <li
                  key={memory.id}
                  className="rounded-md bg-background/45 p-2.5 ring-1 ring-border"
                >
                  {editing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editingDraft}
                        onChange={(event) =>
                          setEditingDraft(event.target.value)
                        }
                        maxLength={1000}
                        className="min-h-16 resize-none text-xs"
                        aria-label="Edit memory"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(null);
                            setEditingDraft("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void updateMemory(memory.id)}
                          disabled={saving || editingDraft.trim().length === 0}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="whitespace-pre-wrap text-xs leading-normal">
                          {memory.content}
                        </p>
                        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                          {memory.id}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(memory.id);
                            setEditingDraft(memory.content);
                          }}
                          aria-label="Edit memory"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setMemoryToDelete(memory)}
                          aria-label="Delete memory"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </MemorySection>

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
    </>
  );
}

function MemorySection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md bg-card p-3 ring-1 ring-border">
      <h3 className="mb-3 text-xs font-semibold">{title}</h3>
      {children}
    </section>
  );
}
