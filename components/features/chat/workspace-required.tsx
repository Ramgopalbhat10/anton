"use client";

import { Button } from "@/components/ui/button";

export function WorkspaceRequired({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  return (
    <div className="grid w-full max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0 md:hidden"
        onClick={onOpenSettings}
      >
        Settings
      </Button>
      <span className="min-w-0 flex-1 truncate">
        Select or clone a workspace before starting a new agent chat.
      </span>
    </div>
  );
}
