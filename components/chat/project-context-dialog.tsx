"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpenText,
  Brain,
  Check,
  Loader2,
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Tab = "memories" | "skills";

type ProjectMemory = {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

type SkillSummary = {
  slug: string;
  name: string;
  description: string;
  path: string;
};

type SkillDocument = SkillSummary & {
  body: string;
};

interface ProjectContextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectContextDialog({
  open,
  onOpenChange,
}: ProjectContextDialogProps) {
  const [tab, setTab] = useState<Tab>("memories");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-context-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div className="flex h-[min(720px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2
              id="project-context-title"
              className="text-sm font-semibold tracking-tight"
            >
              Project Context
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Close project context"
          >
            <X />
          </Button>
        </header>

        <div className="flex border-b border-border px-3 py-2">
          <TabButton
            active={tab === "memories"}
            onClick={() => setTab("memories")}
          >
            <Brain />
            Memories
          </TabButton>
          <TabButton active={tab === "skills"} onClick={() => setTab("skills")}>
            <BookOpenText />
            Skills
          </TabButton>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === "memories" ? (
            <MemoryPanel active={open && tab === "memories"} />
          ) : (
            <SkillsPanel active={open && tab === "skills"} />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function MemoryPanel({ active }: { active: boolean }) {
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [memoryToDelete, setMemoryToDelete] = useState<ProjectMemory | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMemories = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/memories", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { memories: ProjectMemory[] };
      setMemories(data.memories);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Fetching on tab activation updates state after the request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void loadMemories();
  }, [active]);

  const create = async () => {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDraft("");
      await loadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const update = async (id: string) => {
    const content = editingDraft.trim();
    if (!content) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditingId(null);
      setEditingDraft("");
      await loadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      setMemoryToDelete(null);
      await loadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
        <div className="space-y-2">
          <label htmlFor="new-memory" className="text-xs font-medium">
            New memory
          </label>
          <Textarea
            id="new-memory"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={1000}
            placeholder="A durable project preference or fact."
            className="min-h-20 resize-none text-xs"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              {draft.trim().length}/1000
            </span>
            <Button
              type="button"
              size="sm"
              onClick={create}
              disabled={saving || draft.trim().length === 0}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Plus />}
              Add
            </Button>
          </div>
        </div>

        {error && <ErrorBanner message={error} />}

        {loading ? (
          <LoadingState label="Loading memories" />
        ) : memories.length === 0 ? (
          <EmptyState message="No project memories saved." />
        ) : (
          <ul className="space-y-2">
            {memories.map((memory) => {
              const editing = editingId === memory.id;
              return (
                <li
                  key={memory.id}
                  className="rounded-md border border-border bg-background/60 p-3"
                >
                  {editing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editingDraft}
                        onChange={(event) =>
                          setEditingDraft(event.target.value)
                        }
                        maxLength={1000}
                        className="min-h-20 resize-none text-xs"
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
                          <X />
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => update(memory.id)}
                          disabled={saving || editingDraft.trim().length === 0}
                        >
                          <Check />
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {memory.content}
                      </p>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {memory.id}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="icon"
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
                            size="icon"
                            variant="ghost"
                            onClick={() => setMemoryToDelete(memory)}
                            aria-label="Delete memory"
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
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
                if (memoryToDelete) void remove(memoryToDelete.id);
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

function SkillsPanel({ active }: { active: boolean }) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [skillLoading, setSkillLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const loadSkills = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/skills", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          skills: SkillSummary[];
          warnings: string[];
        };
        setSkills(data.skills);
        setWarnings(data.warnings);
        setSelectedSlug((current) =>
          current && data.skills.some((skill) => skill.slug === current)
            ? current
            : data.skills[0]?.slug ?? null,
        );
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load skills");
      } finally {
        setLoading(false);
      }
    };
    void loadSkills();
  }, [active]);

  useEffect(() => {
    if (!selectedSlug) {
      return;
    }
    const loadSkill = async () => {
      setSkillLoading(true);
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(selectedSlug)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { skill: SkillDocument };
        setSelectedSkill(data.skill);
        setError(null);
      } catch (err) {
        setSelectedSkill(null);
        setError(err instanceof Error ? err.message : "Failed to load skill");
      } finally {
        setSkillLoading(false);
      }
    };
    void loadSkill();
  }, [selectedSlug]);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[220px_1fr]">
      <aside className="min-h-0 overflow-y-auto border-b border-border p-3 md:border-b-0 md:border-r">
        {loading ? (
          <LoadingState label="Loading skills" />
        ) : skills.length === 0 ? (
          <EmptyState message="No workspace skills found." />
        ) : (
          <ul className="space-y-1">
            {skills.map((skill) => (
              <li key={skill.slug}>
                <button
                  type="button"
                  onClick={() => setSelectedSlug(skill.slug)}
                  className={cn(
                    "w-full rounded-md px-2 py-2 text-left text-xs transition-colors",
                    selectedSlug === skill.slug
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <span className="block truncate font-medium">{skill.name}</span>
                  <span className="block truncate font-mono text-[10px]">
                    {skill.slug}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="min-h-0 overflow-y-auto p-4">
        {error && <ErrorBanner message={error} />}

        {warnings.length > 0 && (
          <div className="mb-3 space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" />
              Skill warnings
            </div>
            <ul className="list-disc space-y-1 pl-5">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {!selectedSlug ? (
          <EmptyState message="Select a skill to inspect it." />
        ) : skillLoading ? (
          <LoadingState label="Loading skill" />
        ) : selectedSkill ? (
          <article className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{selectedSkill.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedSkill.description || "No description."}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {selectedSkill.path}
              </p>
            </div>
            <pre className="max-h-[460px] overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap">
              {selectedSkill.body || "(empty)"}
            </pre>
          </article>
        ) : null}
      </section>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
      {message}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {message}
    </div>
  );
}
