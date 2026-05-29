import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PanelHeader({
  title,
  actions,
  className,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        "flex h-10 shrink-0 items-center gap-2 border-b border-layout-border px-3",
        className,
      )}
    >
      {children ?? (
        <>
          {title ? (
            <div className="min-w-0 flex-1 truncate text-xs font-medium tracking-tight">
              {title}
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          {actions ? (
            <div className="flex shrink-0 items-center gap-1">{actions}</div>
          ) : null}
        </>
      )}
    </div>
  );
}
