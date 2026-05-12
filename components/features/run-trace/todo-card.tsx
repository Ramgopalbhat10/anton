"use client";

import {
  CheckCircle2,
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

  return (
    <section
      className={cn(
        "rounded-md bg-card/70 text-xs ring-1 ring-border",
        compact ? "p-2" : "p-3",
      )}
    >
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 font-semibold text-foreground">
          <ListTodo className="size-3.5 text-muted-foreground" />
          <span>Todos</span>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {completed}/{snapshot.items.length}
        </span>
      </div>
      <ol className="grid gap-1.5">
        {snapshot.items.map((item) => (
          <li key={item.id}>
            <TodoRow item={item} />
          </li>
        ))}
      </ol>
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
