"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ListTodo,
  Loader2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  AntonTodoItem,
  AntonTodoSnapshot,
  AntonTodoStatus,
} from "@/src/lib/trace";

export function TodoCard({
  snapshot,
  compact = false,
}: {
  snapshot: AntonTodoSnapshot;
  compact?: boolean;
}) {
  const completed = snapshot.items.filter(
    (item) => item.status === "completed",
  ).length;
  const [open, setOpen] = useState(false);

  return (
    <section
      className={cn(
        "rounded-md bg-card/70 text-xs ring-1 ring-border",
        compact ? "p-2" : "p-3",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex w-full min-w-0 items-center justify-between gap-2 rounded text-left",
          open && "mb-2",
        )}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-1.5 font-semibold text-foreground">
          <ListTodo className="size-3.5 text-muted-foreground" />
          <span>Todos</span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          {completed}/{snapshot.items.length}
          {open ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </span>
      </button>
      {open && (
        <ol className="grid gap-1.5">
          {snapshot.items.map((item) => (
            <li key={item.id}>
              <TodoRow item={item} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TodoRow({ item }: { item: AntonTodoItem }) {
  const meta = todoMeta(item.status);
  return (
    <div className="grid grid-cols-[0.875rem_minmax(0,1fr)] gap-2">
      <meta.Icon
        className={cn("mt-0.5 size-3.5", meta.iconClass)}
        aria-hidden
      />
      <span
        className={cn(
          "min-w-0 leading-relaxed text-foreground/85",
          item.status === "completed" && "text-muted-foreground line-through",
        )}
      >
        {item.text}
      </span>
    </div>
  );
}

function todoMeta(status: AntonTodoStatus) {
  if (status === "completed") {
    return { Icon: CheckCircle2, iconClass: "text-emerald-400" };
  }
  if (status === "in_progress") {
    return { Icon: Loader2, iconClass: "animate-spin text-sky-400" };
  }
  return { Icon: Circle, iconClass: "text-muted-foreground" };
}
