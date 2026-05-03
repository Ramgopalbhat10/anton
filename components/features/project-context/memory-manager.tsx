"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

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
  errorMessage,
  getJson,
  jsonHeaders,
  requestJson,
  requestOk,
} from "@/src/lib/client-fetch";
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from "@/components/shared/feedback-states";

type MemoryManagerVariant = "settings" | "compact";

export function useMemories(active: boolean) {
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getJson<{ memories: ProjectMemory[] }>("/api/memories");
      setMemories(data.memories);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load memories"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetching on activation updates state after the request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void loadMemories();
  }, [active, loadMemories]);

  const create = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return false;
      setSaving(true);
      try {
        await requestJson<{ memory: ProjectMemory }>("/api/memories", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ content: trimmed }),
        });
        await loadMemories();
        return true;
      } catch (err) {
        setError(errorMessage(err, "Create failed"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [loadMemories],
  );

  const update = useCallback(
    async (id: string, content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return false;
      setSaving(true);
      try {
        await requestJson<{ memory: ProjectMemory }>(
          `/api/memories/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: jsonHeaders(),
            body: JSON.stringify({ content: trimmed }),
          },
        );
        await loadMemories();
        return true;
      } catch (err) {
        setError(errorMessage(err, "Update failed"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [loadMemories],
  );

  const remove = useCallback(
    async (id: string) => {
      setSaving(true);
      try {
        await requestOk(`/api/memories/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        await loadMemories();
        return true;
      } catch (err) {
        setError(errorMessage(err, "Delete failed"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [loadMemories],
  );

  return {
    memories,
    loading,
    saving,
    error,
    create,
    update,
    remove,
  };
}

export function MemoryManager({
  active,
  variant = "compact",
}: {
  active: boolean;
  variant?: MemoryManagerVariant;
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

  const content = (
    <>
      {error && <ErrorBanner message={error} />}
      <MemorySection title="New memory" variant={variant}>
        <Textarea
          id={variant === "compact" ? "new-memory" : undefined}
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
            {variant === "settings" ? "Add memory" : "Add"}
          </Button>
        </div>
      </MemorySection>

      <MemorySection title="Saved memories" variant={variant}>
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
                          {variant === "compact" && <X />}
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void updateMemory(memory.id)}
                          disabled={saving || editingDraft.trim().length === 0}
                        >
                          {variant === "compact" && <Check />}
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className={variant === "settings" ? "flex items-start justify-between gap-3" : "space-y-2"}>
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

  if (variant === "compact") {
    return (
      <div className="flex h-full flex-col gap-2.5 overflow-y-auto p-3">
        {content}
      </div>
    );
  }

  return <>{content}</>;
}

function MemorySection({
  title,
  variant,
  children,
}: {
  title: string;
  variant: MemoryManagerVariant;
  children: ReactNode;
}) {
  if (variant === "settings") {
    return (
      <section className="rounded-md bg-card p-3 ring-1 ring-border">
        <h3 className="mb-3 text-xs font-semibold">{title}</h3>
        {children}
      </section>
    );
  }

  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium">{title}</h3>
      {children}
    </section>
  );
}
