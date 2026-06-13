"use client";

import type { ReactNode } from "react";
import {
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronRight,
  Hash,
  Layers,
  ListTodo,
  Loader2,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  AntonActivityKind,
  AntonActivityStatus,
  AntonRunStatus,
} from "@/src/lib/trace";

export function TraceTimelineList({
  children,
  showLine = true,
}: {
  children: ReactNode;
  showLine?: boolean;
}) {
  return (
    <ol className="relative space-y-0">
      {showLine ? (
        <div
          aria-hidden
          className="absolute top-2 bottom-2 left-[7px] w-px bg-border/60"
        />
      ) : null}
      {children}
    </ol>
  );
}

export function TraceThreadRoot({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("space-y-3", className)}>{children}</div>;
}

export function TraceThreadNode({ children }: { children: ReactNode }) {
  return <div className="py-0.5">{children}</div>;
}

// Icon column is 0.875rem (14px); thread line aligns to its horizontal center (7px).
const THREAD_ICON_COL = "0.875rem";
const THREAD_ICON_CENTER = "7px";

export function TraceThreadChildren({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative border-l border-border/60 pl-2"
      style={{ marginLeft: THREAD_ICON_CENTER }}
    >
      {children}
    </div>
  );
}

export function TraceThreadHeaderRow({
  icon: Icon,
  iconClass,
  label,
  labelSuffix,
  durationMs,
  status,
  subdued = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
  labelSuffix?: ReactNode;
  durationMs?: number | null;
  status?: AntonRunStatus;
  subdued?: boolean;
}) {
  return (
    <div
      className="grid min-w-0 items-center gap-1.5 py-0.5"
      style={{ gridTemplateColumns: `${THREAD_ICON_COL} minmax(0, 1fr)` }}
    >
      <div className="flex justify-center">
        <Icon
          className={cn(
            "shrink-0",
            subdued ? "size-3" : "size-3.5",
            iconClass,
          )}
        />
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "inline-flex min-w-0 flex-1 items-center gap-1 truncate",
            subdued
              ? "text-xs font-medium text-foreground/85"
              : "text-[12.5px] font-semibold text-foreground/95",
          )}
        >
          <span className="truncate">{label}</span>
          {labelSuffix}
        </span>
        {status === "running" ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-info" />
        ) : status === "error" ? (
          <AlertCircle className="size-3 shrink-0 text-destructive/80" />
        ) : null}
        {durationMs != null ? (
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
            {formatTimelineDuration(durationMs)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function formatTimelineDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

export function TraceTimelineRow({
  kind,
  status,
  label,
  durationMs,
  expandable,
  expanded,
  onToggle,
  summary,
  children,
}: {
  kind: AntonActivityKind | "progress" | "todos";
  status: AntonActivityStatus | "completed" | "error";
  label: string;
  durationMs?: number | null;
  expandable: boolean;
  expanded: boolean;
  onToggle?: () => void;
  summary?: string;
  children?: ReactNode;
}) {
  const meta = timelineEventMeta(kind, status);
  const isCompact = kind === "tool" || (kind === "error" && status !== "running");

  const rowContent = (
    <>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs",
          kind === "reasoning"
            ? "text-muted-foreground/70"
            : kind === "tool"
              ? "text-muted-foreground"
              : "text-foreground/90",
        )}
      >
        {label}
      </span>
      {status !== "completed" &&
      !(kind === "error" && summary) &&
      !expandable ? (
        <StatusPill status={status} />
      ) : null}
      {durationMs != null ? (
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
          {formatTimelineDuration(durationMs)}
        </span>
      ) : null}
      {expandable ? (
        expanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )
      ) : null}
    </>
  );

  return (
    <div className={cn("relative min-w-0", isCompact ? "py-px" : "py-0.5")}>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `${THREAD_ICON_COL} minmax(0, 1fr)` }}
      >
        <div className="relative z-10 flex justify-center pt-0.5">
          <meta.Icon
            className={cn(
              "shrink-0",
              isCompact ? "size-3" : "size-3.5",
              meta.iconClass,
            )}
          />
        </div>
        <div className="min-w-0 pb-0.5">
          {expandable ? (
            <button
              type="button"
              className="flex min-w-0 w-full items-center gap-2 text-left transition-colors hover:text-foreground"
              onClick={onToggle}
              aria-expanded={expanded}
            >
              {rowContent}
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-2">{rowContent}</div>
          )}

          {!expandable && summary ? (
            <p
              className={cn(
                "mt-0.5 line-clamp-2 break-words font-mono text-[10px] leading-snug",
                kind === "error"
                  ? "text-destructive/90"
                  : "text-muted-foreground/90",
              )}
            >
              {summary}
            </p>
          ) : null}
        </div>

        {expandable && expanded && children ? (
          <div className="col-span-2 mt-1.5 min-w-0">{children}</div>
        ) : null}
      </div>
    </div>
  );
}

export function TraceExpandPanel({
  errored,
  denied,
  scrollable = false,
  maxHeight = "max-h-48",
  children,
}: {
  errored?: boolean;
  denied?: boolean;
  scrollable?: boolean;
  maxHeight?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-[10px]",
        !scrollable && "px-3 py-2.5",
        scrollable && "overflow-hidden",
        errored && "border-destructive/25",
        denied && "border-border/60",
      )}
    >
      {scrollable ? (
        <div className={cn("overflow-y-auto", maxHeight)}>
          <div className="px-3 py-2.5">{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function TraceLogBlock({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "error";
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/70",
          tone === "error" && "text-destructive/80",
        )}
      >
        {title}
      </div>
      <div className="overflow-hidden rounded-md border border-layout-border bg-background">
        <div className="max-h-40 overflow-y-auto">
          <pre className="whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[10.5px] leading-[1.65] text-muted-foreground">
            {children}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function PermissionLabel({ label }: { label: string }) {
  return (
    <span className="rounded bg-secondary/60 px-1 py-px font-mono text-[9px] text-muted-foreground ring-1 ring-border/50">
      {label}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const label = statusLabel(status);
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.05em] ring-1",
        status === "completed" &&
          "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
        status === "running" && "bg-sky-500/10 text-sky-400 ring-sky-500/20",
        status === "error" &&
          "bg-destructive/10 text-destructive ring-destructive/20",
        status === "denied" &&
          "bg-secondary text-muted-foreground ring-border/50",
        status === "pending" &&
          "bg-amber-500/10 text-amber-400 ring-amber-500/20",
        status === "approved" &&
          "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
        status === "waiting" &&
          "bg-amber-500/10 text-amber-400 ring-amber-500/20",
        ![
          "completed",
          "running",
          "error",
          "denied",
          "pending",
          "approved",
          "waiting",
        ].includes(status) &&
          "bg-secondary text-muted-foreground ring-border/50",
      )}
    >
      {label}
    </span>
  );
}

export function timelineEventMeta(
  kind: AntonActivityKind | "progress" | "todos",
  status: AntonActivityStatus | "completed" | "error",
) {
  const running = status === "running";
  const errored = status === "error" || kind === "error";

  if (errored) {
    return {
      Icon: AlertCircle,
      iconClass: "text-destructive",
      dotClass: "bg-destructive/15",
    };
  }
  if (running) {
    return {
      Icon: Loader2,
      iconClass: "animate-spin text-info",
      dotClass: "bg-info/15",
    };
  }

  switch (kind) {
    case "reasoning":
      return {
        Icon: Brain,
        iconClass: "text-violet-400",
        dotClass: "bg-violet-400/15",
      };
    case "tool":
      return {
        Icon: TerminalSquare,
        iconClass: "text-(--accent-muted)",
        dotClass: "bg-(--accent-muted)/15",
      };
    case "approval":
      return {
        Icon: ShieldCheck,
        iconClass: "text-info",
        dotClass: "bg-info/15",
      };
    case "step":
      return {
        Icon: Hash,
        iconClass: "text-muted-foreground",
        dotClass: "bg-secondary",
      };
    case "todos":
      return {
        Icon: ListTodo,
        iconClass: "text-info",
        dotClass: "bg-info/15",
      };
    default:
      return {
        Icon: Layers,
        iconClass: "text-success",
        dotClass: "bg-success/15",
      };
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "error":
      return "failed";
    case "completed":
      return "done";
    default:
      return status.replace(/_/g, " ");
  }
}
