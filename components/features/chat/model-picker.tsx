"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import {
  getModelLabel,
  getModelsForProvider,
  getProviderId,
  PROVIDERS,
  type ModelId,
  type ProviderId,
} from "@/src/lib/models";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface ModelPickerProps {
  value: ModelId;
  onChange: (value: ModelId) => void;
  thinkingEnabled?: boolean;
  onThinkingEnabledChange?: (enabled: boolean) => void;
  showThinking?: boolean;
  disabled?: boolean;
  triggerClassName?: string;
}

export function ModelPicker({
  value,
  onChange,
  thinkingEnabled = false,
  onThinkingEnabledChange,
  showThinking = true,
  disabled,
  triggerClassName,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState<ProviderId>(() =>
    getProviderId(value),
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setActiveProvider(getProviderId(value));
    }
    setOpen(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          className={cn(
            "h-7 min-w-0 justify-between gap-1 rounded-md bg-secondary px-2 text-xs font-medium text-muted-foreground hover:text-foreground",
            triggerClassName,
          )}
        >
          <span className="truncate">{getModelLabel(value)}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <Tabs
          value={activeProvider}
          onValueChange={(next) => setActiveProvider(next as ProviderId)}
        >
          <TabsList
            variant="line"
            size="sm"
            className="h-7 w-full rounded-none border-b border-border px-1"
          >
            {PROVIDERS.map((provider) => (
              <TabsTrigger
                key={provider.id}
                value={provider.id}
                className="flex-1 px-1 text-[11px]"
              >
                {provider.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {PROVIDERS.map((provider) => (
            <TabsContent
              key={provider.id}
              value={provider.id}
              className="m-0 max-h-48 overflow-y-auto p-0.5"
            >
              {getModelsForProvider(provider.id).map((model) => {
                const selected = model.id === value;
                return (
                  <button
                    key={model.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-xs leading-4 hover:bg-accent",
                      selected && "bg-accent text-foreground",
                    )}
                    onClick={() => {
                      onChange(model.id);
                      setOpen(false);
                    }}
                  >
                    <span>{model.label}</span>
                    {selected ? <Check className="size-3.5 shrink-0" /> : null}
                  </button>
                );
              })}
            </TabsContent>
          ))}
        </Tabs>
        {showThinking && onThinkingEnabledChange ? (
          <div
            className="flex items-center justify-between gap-4 border-t border-border px-1.5 py-1.5 text-xs"
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
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
