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
import { Switch } from "@/components/ui/switch";

interface ModelPickerProps {
  value: ModelId;
  onChange: (value: ModelId) => void;
  thinkingEnabled: boolean;
  onThinkingEnabledChange: (enabled: boolean) => void;
  disabled?: boolean;
  triggerClassName?: string;
}

export function ModelPicker({
  value,
  onChange,
  thinkingEnabled,
  onThinkingEnabledChange,
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
        <div
          className="flex items-center justify-between gap-4 border-t border-border px-2 py-2 text-xs"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <span className="font-medium text-muted-foreground">Thinking</span>
          <Switch
            checked={thinkingEnabled}
            onCheckedChange={onThinkingEnabledChange}
            className="h-4 w-7 ring-0 data-[state=checked]:ring-0"
            thumbClassName="size-3 data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0.5"
            aria-label="Toggle model thinking"
          />
        </div>
      </SelectContent>
    </Select>
  );
}
