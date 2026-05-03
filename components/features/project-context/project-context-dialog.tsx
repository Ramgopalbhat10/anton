"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BookOpenText, Brain, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MemoryManager } from "./memory-manager";
import { SkillsBrowser } from "./skills-browser";

type Tab = "memories" | "skills";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-context-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div className="flex h-[min(680px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-card shadow-none ring-1 ring-border">
        <header className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
          <h2
            id="project-context-title"
            className="truncate text-xs font-semibold tracking-tight"
          >
            Project Context
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            aria-label="Close project context"
          >
            <X />
          </Button>
        </header>

        <div className="flex border-b border-border px-2 py-1.5">
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
            <MemoryManager active={open && tab === "memories"} />
          ) : (
            <SkillsBrowser active={open && tab === "skills"} />
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
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors [&_svg]:size-3.5",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
