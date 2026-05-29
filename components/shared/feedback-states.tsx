"use client";

import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      {label}
    </div>
  );
}

const emptyStateVariants = cva("text-xs text-muted-foreground", {
  variants: {
    variant: {
      panel:
        "rounded-md bg-secondary/40 px-2 py-2 ring-1 ring-border/70",
      inline: "px-1 py-1",
      centered:
        "mx-auto max-w-sm rounded-md bg-secondary/40 px-2.5 py-3 text-center ring-1 ring-border/70",
    },
  },
  defaultVariants: {
    variant: "panel",
  },
});

export function EmptyState({
  message,
  variant,
  className,
}: {
  message: string;
} & VariantProps<typeof emptyStateVariants> & {
    className?: string;
  }) {
  return (
    <div className={cn(emptyStateVariants({ variant }), className)}>{message}</div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive ring-1 ring-destructive/30">
      {message}
    </div>
  );
}
