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
  dotClass,
  label,
  labelSuffix,
  durationMs,
  status,
  subdued = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  dotClass: string;
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
        <span
          className={cn(
            "flex size-3.5 shrink-0 items-center justify-center rounded-full ring-2 ring-background",
            dotClass,
          )}
        >
          <Icon className={cn("size-2.5", iconClass)} />
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "inline-flex min-w-0 flex-1 items-center gap-1 truncate text-[11px]",
            subdued
              ? "font-medium text-foreground/85"
              : "font-semibold text-foreground/95",
          )}
        >
          <span className="truncate">{label}</span>
          {labelSuffix}
        </span>
        {status === "running" ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-sky-400" />
        ) : status === "error" ? (
          <AlertCircle className="size-3 shrink-0 text-destructive/80" />
        ) : null}
        {durationMs != null ? (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
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
      <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/90">
        {label}
      </span>
      {status !== "completed" &&
      !(kind === "error" && summary) &&
      !expandable ? (
        <StatusPill status={status} />
      ) : null}
      {durationMs != null ? (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
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
          <span
            className={cn(
              "flex items-center justify-center rounded-full ring-2 ring-background",
              isCompact ? "size-3" : "size-3.5",
              meta.dotClass,
            )}
          >
            <meta.Icon
              className={cn(isCompact ? "size-2" : "size-2.5", meta.iconClass)}
            />
          </span>
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

          {expandable && expanded && children ? (
            <div className="mt-1.5">{children}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function TraceExpandPanel({
  errored,
  denied,
  children,
}: {
  errored?: boolean;
  denied?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border/50 bg-background/30 px-2 py-1.5 text-[10px]",
        errored && "border-destructive/25 bg-destructive/[0.03]",
        denied && "border-border/40 bg-secondary/15",
      )}
    >
      {children}
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
          "text-[9px] font-medium uppercase tracking-wide text-muted-foreground",
          tone === "error" && "text-destructive/80",
        )}
      >
        {title}
      </div>
      <pre className="max-h-40 overflow-auto rounded-md bg-background/70 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-words ring-1 ring-border/40">
        {children}
      </pre>
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
        "shrink-0 rounded px-1 py-px text-[9px] font-medium uppercase tracking-wide ring-1",
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
      iconClass: "animate-spin text-sky-400",
      dotClass: "bg-sky-400/15",
    };
  }

  switch (kind) {
    case "reasoning":
      return {
        Icon: Brain,
        iconClass: "text-violet-400/90",
        dotClass: "bg-violet-400/15",
      };
    case "tool":
      return {
        Icon: TerminalSquare,
        iconClass: "text-amber-400/90",
        dotClass: "bg-amber-400/15",
      };
    case "approval":
      return {
        Icon: ShieldCheck,
        iconClass: "text-sky-400/90",
        dotClass: "bg-sky-400/15",
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
        iconClass: "text-sky-400/90",
        dotClass: "bg-sky-400/15",
      };
    default:
      return {
        Icon: Layers,
        iconClass: "text-emerald-400/90",
        dotClass: "bg-emerald-400/15",
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
