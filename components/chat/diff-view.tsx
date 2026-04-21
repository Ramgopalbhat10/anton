"use client";

import { useMemo } from "react";
import { diffLines } from "diff";
import { cn } from "@/lib/utils";

interface DiffViewProps {
  previous: string;
  next: string;
  newFile?: boolean;
}

export function DiffView({ previous, next, newFile }: DiffViewProps) {
  const rows = useMemo(() => buildRows(previous, next), [previous, next]);
  const { added, removed } = useMemo(() => countChanges(rows), [rows]);

  if (rows.length === 0) {
    return (
      <div className="rounded border border-border bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
        No changes.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-background/60 font-mono text-[11px] leading-snug">
      <div className="flex items-center gap-3 border-b border-border px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>diff</span>
        {newFile ? (
          <span className="text-emerald-600 dark:text-emerald-400">
            new file
          </span>
        ) : null}
        <span className="ml-auto tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>
          <span className="mx-1 text-muted-foreground/50">/</span>
          <span className="text-destructive">-{removed}</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <pre className="m-0 p-0">
          {rows.map((row, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-2 px-3 whitespace-pre",
                row.kind === "add" && "bg-emerald-500/10",
                row.kind === "remove" && "bg-destructive/10",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "w-3 shrink-0 select-none text-center",
                  row.kind === "add" && "text-emerald-600 dark:text-emerald-400",
                  row.kind === "remove" && "text-destructive",
                  row.kind === "context" && "text-muted-foreground/50",
                )}
              >
                {row.kind === "add" ? "+" : row.kind === "remove" ? "-" : " "}
              </span>
              <span className="flex-1">{row.text || " "}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

type DiffRow = { kind: "add" | "remove" | "context"; text: string };

function buildRows(previous: string, next: string): DiffRow[] {
  const parts = diffLines(previous, next);
  const rows: DiffRow[] = [];
  for (const part of parts) {
    const kind: DiffRow["kind"] = part.added
      ? "add"
      : part.removed
        ? "remove"
        : "context";
    const lines = stripTrailingNewline(part.value).split("\n");
    for (const line of lines) rows.push({ kind, text: line });
  }
  return rows;
}

function stripTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s.slice(0, -1) : s;
}

function countChanges(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.kind === "add") added++;
    else if (r.kind === "remove") removed++;
  }
  return { added, removed };
}
