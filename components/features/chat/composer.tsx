"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  Code2,
  DatabaseZap,
  MessageCircle,
  Plus,
  ScrollText,
  Search,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ModelId } from "@/src/lib/models";
import type { ChatMode } from "@/src/lib/chat-modes";
import type { PermissionMode } from "@/src/agent/permissions";
import type { McpServerSummary, ProjectSummary } from "@/src/lib/api-types";
import type { SessionTokenUsage } from "@/src/lib/token-usage";
import { BranchSwitcher } from "@/components/features/projects/branch-switcher";
import { ProjectPicker } from "@/components/features/projects/project-picker";
import { ModelPicker } from "./model-picker";
import { SessionMetricsHoverCard } from "./metrics-hover-card";

interface ComposerProps {
  onSend: (text: string) => boolean | Promise<boolean>;
  onStop: () => void;
  disabled: boolean;
  streaming: boolean;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  model: ModelId;
  onModelChange: (model: ModelId) => void;
  thinkingEnabled: boolean;
  onThinkingEnabledChange: (enabled: boolean) => void;
  tokenUsage: SessionTokenUsage;
  project: ProjectSummary | null;
  projectBranch: string | null;
  readyProjects: ProjectSummary[];
  projectsLoading: boolean;
  projectsError: string | null;
  selectedProjectId: string | null;
  onSelectedProjectIdChange: (projectId: string) => void;
  projectLocked: boolean;
  onRefreshProjects: () => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  mcpServers: McpServerSummary[];
  selectedMcpServerIds: string[];
  onSelectedMcpServerIdsChange: (ids: string[]) => void;
  runningCommandCount?: number;
  onOpenProjectStatus?: () => void;
}

const MIN_HEIGHT = 24;
const MAX_HEIGHT = 44;

export function Composer({
  onSend,
  onStop,
  disabled,
  streaming,
  mode,
  onModeChange,
  model,
  onModelChange,
  thinkingEnabled,
  onThinkingEnabledChange,
  tokenUsage,
  project,
  projectBranch,
  readyProjects,
  projectsLoading,
  projectsError,
  selectedProjectId,
  onSelectedProjectIdChange,
  projectLocked,
  onRefreshProjects,
  permissionMode,
  onPermissionModeChange,
  mcpServers,
  selectedMcpServerIds,
  onSelectedMcpServerIdsChange,
  runningCommandCount = 0,
  onOpenProjectStatus,
}: ComposerProps) {
  const [input, setInput] = useState("");
  const [mcpOpen, setMcpOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendDisabled = disabled || (mode !== "chat" && !project);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [input]);

  const submit = () => {
    const trimmed = input.trim();
    if (!trimmed || sendDisabled) return;
    void Promise.resolve(onSend(trimmed)).then((sent) => {
      if (sent) {
        setInput("");
      }
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="relative z-40 w-full max-w-full shrink-0 overflow-visible bg-background px-3 pb-2 pt-1 sm:px-4"
    >
      <div className="mx-auto w-full max-w-[calc(100vw-1.5rem)] min-w-0 sm:max-w-3xl">
        <div className="rounded-lg bg-card p-2 ring-1 ring-border">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholderForMode(mode)}
            rows={1}
            className="field-sizing-fixed min-h-0 min-w-0 resize-none rounded-none border-0 bg-transparent p-0 font-mono text-xs leading-5 shadow-none placeholder:font-mono focus-visible:ring-0 dark:bg-transparent md:text-xs"
            style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-5 px-1.5 text-[11px]"
                disabled={disabled}
                aria-label="Add context"
              >
                <Plus />
              </Button>
              <ModeSelector value={mode} onChange={onModeChange} disabled={disabled} />
              <PermissionsDropdown
                value={permissionMode}
                onChange={onPermissionModeChange}
              />
              <McpSelector
                servers={mcpServers}
                selectedIds={selectedMcpServerIds}
                open={mcpOpen}
                onOpenChange={setMcpOpen}
                onSelectedIdsChange={onSelectedMcpServerIdsChange}
                disabled={disabled || mode !== "agent" || !project}
              />
            </div>

            <div className="flex min-w-0 items-center gap-1.5">
              <TokenCounter tokenUsage={tokenUsage} pending={streaming} />
              <ModelPicker
                value={model}
                onChange={onModelChange}
                thinkingEnabled={thinkingEnabled}
                onThinkingEnabledChange={onThinkingEnabledChange}
                disabled={streaming}
                triggerClassName="h-5 w-36 px-1.5 text-[11px]"
              />
              {streaming ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  onClick={onStop}
                  aria-label="Stop generation"
                >
                  <Square className="fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-xs"
                  disabled={sendDisabled || !input.trim()}
                  aria-label="Send message"
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1.5 text-[11px] font-medium text-muted-foreground">
          <ProjectPicker
            projects={readyProjects}
            selectedProjectId={selectedProjectId}
            selectedProject={project}
            locked={projectLocked}
            disabled={disabled}
            loading={projectsLoading}
            error={projectsError}
            onSelect={onSelectedProjectIdChange}
            onRefresh={onRefreshProjects}
            className="max-w-[20rem]"
            contentAlign="start"
          />
          <BranchSwitcher
            project={project}
            currentBranch={projectBranch}
            showProjectName={false}
            className="max-w-[20rem]"
            contentAlign="start"
          />
          {runningCommandCount > 0 ? (
            <button
              type="button"
              onClick={onOpenProjectStatus}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-400/30 hover:bg-emerald-400/15"
            >
              {runningCommandCount} running
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

const MODE_ITEMS = [
  { value: "chat", label: "Chat", description: "Pure Q&A", Icon: MessageCircle },
  { value: "ask", label: "Ask", description: "Reads project", Icon: Search },
  { value: "plan", label: "Plan", description: "Plans changes", Icon: ScrollText },
  { value: "agent", label: "Agent", description: "Can edit code", Icon: Code2 },
] as const satisfies readonly {
  value: ChatMode;
  label: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
}[];

function ModeSelector({
  value,
  onChange,
  disabled,
}: {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
  disabled: boolean;
}) {
  const selected = MODE_ITEMS.find((item) => item.value === value) ?? MODE_ITEMS[1];
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as ChatMode)}
      disabled={disabled}
    >
      <SelectTrigger className="h-5 gap-1 border-0 bg-transparent px-1.5 text-[11px] font-medium leading-4 text-muted-foreground hover:bg-accent hover:text-foreground">
        <selected.Icon className="size-3.5 shrink-0" />
        <SelectValue>{selected.label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-40">
        <SelectViewport className="p-0.5">
          {MODE_ITEMS.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              className="py-1 pr-7 pl-1.5"
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="inline-flex items-center gap-1.5 text-xs leading-4 text-foreground">
                  <item.Icon className="size-3.5 text-muted-foreground" />
                  {item.label}
                </span>
                <span className="pl-5 text-[10px] leading-3 text-muted-foreground">
                  {item.description}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectViewport>
      </SelectContent>
    </Select>
  );
}

function placeholderForMode(mode: ChatMode): string {
  switch (mode) {
    case "chat":
      return "Ask anything";
    case "ask":
      return "Ask about this project";
    case "plan":
      return "Ask Anton to plan the work";
    case "agent":
      return "Ask Anton to change the code";
  }
}

function McpSelector({
  servers,
  selectedIds,
  open,
  onOpenChange,
  onSelectedIdsChange,
  disabled,
}: {
  servers: McpServerSummary[];
  selectedIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectedIdsChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const enabledServers = servers.filter((server) => server.enabled);
  const selectedCount = enabledServers.filter((server) =>
    selectedIds.includes(server.id),
  ).length;
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="h-5 px-1.5 text-[11px] text-primary hover:bg-primary/10"
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-label="Select MCP servers"
      >
        <DatabaseZap />
        MCP {selectedCount}
      </Button>
      {open && !disabled && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-56 rounded-md bg-popover p-1 text-xs text-popover-foreground shadow-lg ring-1 ring-border">
          {enabledServers.length === 0 ? (
            <div className="px-1.5 py-1.5 text-muted-foreground">
              No enabled MCP servers.
            </div>
          ) : (
            <ul className="grid gap-0.5">
              {enabledServers.map((server) => {
                const checked = selectedIds.includes(server.id);
                return (
                  <li key={server.id}>
                    <div
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-1.5 py-1 text-primary"
                    >
                      <span className="truncate text-[11px] font-medium leading-4">
                        {server.displayName}
                      </span>
                      <Switch
                        checked={checked}
                        className="h-4 w-7 ring-0 data-[state=checked]:ring-0"
                        thumbClassName="size-3 data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0.5"
                        aria-label={`${checked ? "Disable" : "Enable"} ${server.displayName} MCP server`}
                        onCheckedChange={() => {
                          onSelectedIdsChange(
                            checked
                              ? selectedIds.filter((id) => id !== server.id)
                              : [...selectedIds, server.id],
                          );
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const PERMISSION_MODE_ITEMS = [
  { value: "default", label: "Ask every time", Icon: ShieldQuestion },
  { value: "auto-review", label: "Auto-review", Icon: ShieldCheck },
  { value: "full-access", label: "Full access", Icon: ShieldOff },
] as const satisfies readonly {
  value: PermissionMode;
  label: string;
  Icon: typeof ShieldCheck;
}[];

function PermissionsDropdown({
  value,
  onChange,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}) {
  const selected =
    PERMISSION_MODE_ITEMS.find((item) => item.value === value) ??
    PERMISSION_MODE_ITEMS[1];
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PermissionMode)}>
      <SelectTrigger className="h-5 gap-1 border-0 bg-transparent px-1.5 text-[11px] font-medium leading-4 text-primary hover:bg-primary/10">
        <selected.Icon className="size-3.5 shrink-0" />
        <SelectValue>{selected.label}</SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-36">
        <SelectViewport className="p-0.5">
          {PERMISSION_MODE_ITEMS.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              className="py-1 pr-7 pl-1.5"
            >
              <span className="inline-flex items-center gap-1.5 text-xs leading-4">
                <item.Icon className="size-3.5" />
                {item.label}
              </span>
            </SelectItem>
          ))}
        </SelectViewport>
      </SelectContent>
    </Select>
  );
}

function TokenCounter({
  tokenUsage,
  pending,
}: {
  tokenUsage: SessionTokenUsage;
  pending: boolean;
}) {
  if (tokenUsage.effectiveTokens <= 0 && !pending) return null;
  return <SessionMetricsHoverCard tokenUsage={tokenUsage} />;
}
