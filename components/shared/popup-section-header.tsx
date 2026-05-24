"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PopupSectionHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 px-1.5 py-1",
        className,
      )}
    >
      <span className="text-[10px] font-medium uppercase text-muted-foreground">
        {title}
      </span>
      {action}
    </div>
  );
}
