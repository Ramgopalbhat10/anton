"use client";

import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

export function SearchField({
  value,
  onChange,
  placeholder = "Search...",
  className,
  inputClassName,
  "aria-label": ariaLabel = "Search",
}: {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  "aria-label"?: string;
}) {
  return (
    <label
      className={cn(
        "grid grid-cols-[0.75rem_1fr] items-center gap-1 rounded-md bg-secondary/80 px-1.5 py-1 ring-1 ring-border transition-colors focus-within:ring-ring/50",
        className,
      )}
    >
      <Search className="size-3 shrink-0 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          "min-w-0 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground",
          inputClassName,
        )}
      />
    </label>
  );
}
