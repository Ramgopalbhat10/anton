"use client";

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
        aria-label={ariaLabel}
        className={cn(
          "h-5 min-w-0 max-w-[6.5rem] shrink-0 gap-0.5 border-0 bg-transparent px-1 py-0 text-[10px] font-medium leading-4 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-2.5",
          className,
        )}
      >
        <SelectValue className="truncate">{selected?.label ?? "Sort"}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-32">
        <SelectViewport className="p-0.5">
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="py-1 pr-7 pl-1.5 text-xs leading-4"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectViewport>
      </SelectContent>
    </Select>
  );
}
