"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { ApprovalMetadata } from "@/src/lib/trace";

export function ApprovalDetails({
  approval,
  compact = false,
}: {
  approval: ApprovalMetadata;
  compact?: boolean;
}) {
  const visibleDetails = compact
    ? approval.details.slice(0, 3)
    : approval.details;

  return (
    <div
      className={cn(
        "space-y-1 text-muted-foreground",
        compact ? "text-[10px]" : "text-[11px]",
      )}
    >
      <div>
        <span className="font-medium text-foreground/80">{approval.title}</span>
        <span> - {approval.summary}</span>
      </div>
      {approval.command ? (
        <div className="flex min-w-0 flex-wrap gap-1 font-mono text-[9px] text-muted-foreground">
          {approval.command.commandPolicyMode ? (
            <MetaChip>policy {approval.command.commandPolicyMode}</MetaChip>
          ) : null}
          <MetaChip className="max-w-full truncate">
            cwd {approval.command.cwd}
          </MetaChip>
          <MetaChip>{approval.command.timeoutMs}ms</MetaChip>
          <MetaChip>{approval.command.outputCapBytes}B/stream</MetaChip>
          {approval.command.boundary ? (
            <>
              <MetaChip>{approval.command.boundary.label}</MetaChip>
              <MetaChip>Unconfined</MetaChip>
            </>
          ) : null}
        </div>
      ) : null}
      <ul className="space-y-0.5">
        {visibleDetails.map((detail) => (
          <li key={detail} className="break-words">
            {detail}
          </li>
        ))}
      </ul>
      {compact && approval.details.length > visibleDetails.length && (
        <div>{approval.details.length - visibleDetails.length} more detail(s) in Worklog</div>
      )}
    </div>
  );
}

function MetaChip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded bg-secondary/50 px-1 py-px ring-1 ring-border/40",
        className,
      )}
    >
      {children}
    </span>
  );
}
