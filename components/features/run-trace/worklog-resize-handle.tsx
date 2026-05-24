"use client";

import { cn } from "@/lib/utils";

interface WorklogResizeHandleProps {
  onResizeStart: (clientX: number) => void;
  active?: boolean;
}

export function WorklogResizeHandle({
  onResizeStart,
  active = false,
}: WorklogResizeHandleProps) {
  return (
    <button
      type="button"
      aria-label="Resize trace workspace"
      title="Drag to resize"
      onMouseDown={(event) => {
        event.preventDefault();
        onResizeStart(event.clientX);
      }}
      className={cn(
        "absolute top-0 left-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize border-0 bg-transparent p-0",
        "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border/80 before:transition-colors",
        "hover:before:bg-ring/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active && "before:bg-ring",
      )}
    />
  );
}
