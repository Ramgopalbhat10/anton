"use client";

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
