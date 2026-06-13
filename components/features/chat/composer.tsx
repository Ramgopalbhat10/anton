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
  ChevronDown,
  CodeXml,
  Globe,
  ListTodo,
  MessageCircle,
  Plus,
  Search,
  Server,
  Settings,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  Square,
  TerminalSquare,
} from "lucide-react";
import { Badge } from "@/components/shared/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

const COMPOSER_CHIP =
  "h-[26px] gap-1.5 rounded-md bg-secondary px-2 text-xs font-medium leading-4 text-foreground shadow-none ring-0 hover:bg-secondary/80 focus-visible:ring-0";

const COMPOSER_CHIP_OUTLINE =
  "h-[26px] gap-1.5 rounded-md bg-transparent px-2 text-xs font-medium leading-4 text-muted-foreground/80 shadow-none ring-1 ring-border hover:bg-secondary/40 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring";

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
      <div className="mx-auto w-full max-w-[calc(100vw-1.5rem)] min-w-0 sm:max-w-[720px]">
        <div className="rounded-xl bg-card p-3 ring-1 ring-border">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholderForMode(mode)}
            rows={1}
            className="field-sizing-fixed min-h-0 min-w-0 resize-none rounded-none border-0 bg-transparent p-0 font-mono text-[13px] leading-5 shadow-none ring-0 placeholder:font-mono placeholder:text-(--accent-muted) focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent md:text-[13px]"
            style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-[26px] rounded-md text-muted-foreground hover:text-foreground"
                disabled={disabled}
                aria-label="Add context"
              >
                <Plus className="size-3.5" />
              </Button>
              <ModeSelector value={mode} onChange={onModeChange} disabled={disabled} />
              <PermissionsDropdown
                value={permissionMode}
                onChange={onPermissionModeChange}
              />
              <McpSelector
                servers={mcpServers}
                selectedIds={selectedMcpServerIds}
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
                triggerClassName="h-[26px] w-40 justify-between gap-2 rounded-md bg-input px-2.5 text-xs font-normal text-foreground shadow-none ring-1 ring-border hover:bg-input/80 sm:w-48"
              />
              {streaming ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  onClick={onStop}
                  className="size-[26px] rounded-md"
                  aria-label="Stop generation"
                >
                  <Square className="fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-xs"
                  disabled={sendDisabled || !input.trim()}
                  className="size-[26px] rounded-md"
                  aria-label="Send message"
                >
                  <ArrowUp className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1.5 text-[12.5px] font-medium text-muted-foreground">
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
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onOpenProjectStatus}
              className="h-auto p-0 hover:bg-transparent"
            >
              <Badge variant="success" className="normal-case tracking-normal">
                {runningCommandCount} running
              </Badge>
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

const MODE_ITEMS = [
  { value: "chat", label: "Chat", description: "Pure Q&A", Icon: MessageCircle },
  { value: "ask", label: "Ask", description: "Reads project", Icon: Search },
  { value: "plan", label: "Plan", description: "Plans changes", Icon: ListTodo },
  { value: "agent", label: "Agent", description: "Can edit code", Icon: CodeXml },
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
      <SelectTrigger className={COMPOSER_CHIP}>
        <selected.Icon className="size-3 shrink-0 text-muted-foreground" />
        <SelectValue>{selected.label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[220px]">
        <SelectViewport className="p-1.5">
          {MODE_ITEMS.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              className="py-[7px] pr-8 pl-2.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <item.Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="grid min-w-0 gap-px">
                  <span className="text-[13px] font-medium leading-4 text-foreground">
                    {item.label}
                  </span>
                  <span className="text-[11.5px] leading-4 text-muted-foreground/80">
                    {item.description}
                  </span>
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
  onSelectedIdsChange,
  disabled,
}: {
  servers: McpServerSummary[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const enabledServers = servers.filter((server) => server.enabled);
  const selectedCount = enabledServers.filter((server) =>
    selectedIds.includes(server.id),
  ).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className={cn(
            COMPOSER_CHIP_OUTLINE,
            selectedCount > 0 && "text-foreground",
          )}
          disabled={disabled}
          aria-label="Select MCP servers"
        >
          <Server className="size-3 text-muted-foreground" />
          MCP {selectedCount}
          <ChevronDown className="size-3 shrink-0 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[280px] overflow-hidden p-0"
      >
        <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
            MCP servers
          </span>
          <span className="text-[10.5px] text-muted-foreground/70">
            {selectedCount} enabled
          </span>
        </div>
        {enabledServers.length === 0 ? (
          <div className="px-3 pb-3 pt-1 text-xs text-muted-foreground">
            No enabled MCP servers.
          </div>
        ) : (
          <ul>
            {enabledServers.map((server) => {
              const checked = selectedIds.includes(server.id);
              return (
                <li key={server.id}>
                  <div className="flex w-full items-center gap-2.5 px-3 py-2.5">
                    {server.transport === "stdio" ? (
                      <TerminalSquare className="size-[13px] shrink-0 text-muted-foreground" />
                    ) : (
                      <Globe className="size-[13px] shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-4 text-foreground">
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
        <div className="flex items-center gap-2 border-t border-layout-border px-3 py-2 text-[12.5px] text-muted-foreground/70">
          <Settings className="size-3" />
          Manage servers in settings
        </div>
      </PopoverContent>
    </Popover>
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
  const isFullAccessMode = value === "full-access";
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PermissionMode)}>
      <SelectTrigger
        className={cn(
          COMPOSER_CHIP,
          isFullAccessMode &&
            "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
        )}
      >
        <selected.Icon
          className={cn(
            "size-3 shrink-0",
            isFullAccessMode ? "text-primary" : "text-muted-foreground",
          )}
        />
        <SelectValue>{selected.label}</SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-[210px]">
        <SelectViewport className="p-1.5">
          {PERMISSION_MODE_ITEMS.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              className="py-2 pr-8 pl-2.5"
            >
              <span className="inline-flex items-center gap-2.5 text-[13px] font-medium leading-4 text-foreground">
                <item.Icon
                  className={cn(
                    "size-3.5",
                    item.value === "full-access"
                      ? "text-primary"
                      : "text-muted-foreground",
                  )}
                />
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
