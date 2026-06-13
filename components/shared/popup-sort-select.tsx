"use client";

import { ListFilter } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "@/components/ui/select";

export type PopupSortOption<T extends string> = {
  value: T;
  label: string;
};

export function PopupSortSelect<T extends string>({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
  className,
}: {
  value: T;
  options: readonly PopupSortOption<T>[];
  onChange: (value: T) => void;
  "aria-label": string;
  className?: string;
}) {
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger
        hideChevron
        aria-label={`${ariaLabel}: ${selected?.label ?? "Sort"}`}
        title={selected?.label ?? "Sort"}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring [&_[data-slot=select-value]]:sr-only",
          className,
        )}
      >
        <ListFilter className="size-3" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        align="start"
        side="right"
        sideOffset={6}
        className="z-[100] min-w-[150px]"
      >
        <SelectViewport className="p-1.5">
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="py-[5px] pr-8 pl-[9px] text-[12.5px] leading-4 text-foreground data-[state=checked]:font-medium"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectViewport>
      </SelectContent>
    </Select>
  );
}
