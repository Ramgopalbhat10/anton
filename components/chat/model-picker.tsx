"use client";

import { MODEL_CATALOG, type ModelId } from "@/src/lib/providers";
import { cn } from "@/lib/utils";

interface ModelPickerProps {
  value: ModelId;
  onChange: (value: ModelId) => void;
  disabled?: boolean;
}

export function ModelPicker({ value, onChange, disabled }: ModelPickerProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ModelId)}
      disabled={disabled}
      className={cn(
        "h-8 rounded-md border border-input bg-background px-2 text-xs",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      {MODEL_CATALOG.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
