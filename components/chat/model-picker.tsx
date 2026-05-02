"use client";

import { MODEL_CATALOG, type ModelId } from "@/src/lib/models";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "@/components/ui/select";

interface ModelPickerProps {
  value: ModelId;
  onChange: (value: ModelId) => void;
  disabled?: boolean;
  triggerClassName?: string;
}

export function ModelPicker({
  value,
  onChange,
  disabled,
  triggerClassName,
}: ModelPickerProps) {
  const selected = MODEL_CATALOG.find((model) => model.id === value);

  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as ModelId)}
      disabled={disabled}
    >
      <SelectTrigger className={triggerClassName ?? "w-44"}>
        <SelectValue>{selected?.label ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectViewport>
          {MODEL_CATALOG.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.label}
            </SelectItem>
          ))}
        </SelectViewport>
      </SelectContent>
    </Select>
  );
}
