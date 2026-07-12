"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentType,
  type DragEvent,
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
import type {
  ComposerSkillSummary,
  McpServerSummary,
  ProjectSummary,
} from "@/src/lib/api-types";
import type { SessionTokenUsage } from "@/src/lib/token-usage";
import type { AntonWorkspaceReference } from "@/src/lib/trace";
import { errorMessage, getJson } from "@/src/lib/client-fetch";
import { BranchSwitcher } from "@/components/features/projects/branch-switcher";
import { ProjectPicker } from "@/components/features/projects/project-picker";
import { useProjectFileTree } from "@/components/features/projects/hooks";
import { ModelPicker } from "./model-picker";
import { SessionMetricsHoverCard } from "./metrics-hover-card";
import {
  appendAttachmentFiles,
  ATTACHMENT_ACCEPT,
  findComposerTrigger,
  skillSuggestions,
  workspaceSuggestions,
  type ComposerSendPayload,
  type ComposerSuggestion,
} from "./composer-context";
import {
  AttachmentTray,
  ComposerSuggestionPopover,
  WorkspaceReferenceTray,
} from "./composer-parts";

interface ComposerProps {
  onSend: (payload: ComposerSendPayload) => boolean | Promise<boolean>;
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
  columnWidth?: number;
  worklogOpen?: boolean;
}

const MIN_HEIGHT = 24;
const MAX_HEIGHT = 44;

type ComposerVariant = "full" | "compact" | "inline";

const COMPOSER_CONTROL_H =
  "!h-[26px] !min-h-[26px] !max-h-[26px] shrink-0 py-0 leading-none";
const COMPOSER_ICON_BTN = "size-[26px] shrink-0 rounded-md";

const COMPOSER_CHIP = cn(
  COMPOSER_CONTROL_H,
  "gap-1.5 rounded-md bg-secondary px-2 text-xs font-medium leading-4 text-foreground shadow-none ring-0 hover:bg-secondary/80 focus-visible:ring-0",
);

const MODEL_TRIGGER = cn(
  COMPOSER_CONTROL_H,
  "justify-between gap-2 rounded-md bg-input px-2 text-xs font-normal text-foreground shadow-none ring-1 ring-border hover:bg-input/80",
);

function resolveComposerVariant(
  width: number,
  worklogOpen: boolean,
  hasSessionMetrics: boolean,
): ComposerVariant {
  if (width <= 0) {
    return worklogOpen || hasSessionMetrics ? "inline" : "full";
  }
  if (width < 320) return "compact";
  if (width < 400) return "compact";
  if (worklogOpen) return "inline";

  const inlineThreshold = hasSessionMetrics ? 720 : 480;
  if (width < inlineThreshold) return "inline";

  return "full";
}

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
  columnWidth = 0,
  worklogOpen = false,
}: ComposerProps) {
  const [input, setInput] = useState("");
  const [workspaceReferences, setWorkspaceReferences] = useState<
    AntonWorkspaceReference[]
  >([]);
  const [attachments, setAttachments] = useState<ComposerSendPayload["files"]>(
    [],
  );
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [skills, setSkills] = useState<ComposerSkillSummary[]>([]);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasSessionMetrics = tokenUsage.effectiveTokens > 0 || streaming;
  const variant = resolveComposerVariant(columnWidth, worklogOpen, hasSessionMetrics);
  const sendDisabled = disabled || (mode !== "chat" && !project);
  const hasSendContent =
    input.trim().length > 0 ||
    workspaceReferences.length > 0 ||
    attachments.length > 0;
  const iconOnly = variant !== "full";
  const compactContext = variant !== "full";
  const readyProjectId = project?.status === "ready" ? project.id : null;
  const fileTreeState = useProjectFileTree(readyProjectId);

  useEffect(() => {
    let cancelled = false;
    const loadSkills = async () => {
      const params = new URLSearchParams({ scope: "composer" });
      if (readyProjectId) params.set("projectId", readyProjectId);
      try {
        const data = await getJson<{
          skills: ComposerSkillSummary[];
          warnings: string[];
        }>(`/api/skills?${params.toString()}`);
        if (cancelled) return;
        setSkills(data.skills);
        setSkillsError(null);
      } catch (err) {
        if (cancelled) return;
        setSkills([]);
        setSkillsError(errorMessage(err, "Failed to load skills"));
      }
    };
    void loadSkills();
    return () => {
      cancelled = true;
    };
  }, [readyProjectId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setWorkspaceReferences([]);
    });
    return () => {
      cancelled = true;
    };
  }, [readyProjectId]);

  const trigger = useMemo(
    () => findComposerTrigger(input, caret),
    [caret, input],
  );
  const suggestions = useMemo(() => {
    if (!trigger) return [];
    if (trigger.kind === "slash") {
      return skillSuggestions(skills, trigger.query);
    }
    return workspaceSuggestions(
      fileTreeState.fileTree,
      trigger.query,
      workspaceReferences,
    );
  }, [fileTreeState.fileTree, skills, trigger, workspaceReferences]);
  const suggestionsOpen = trigger !== null && suggestions.length > 0;
  const activeSuggestionIndex =
    suggestions.length === 0
      ? 0
      : Math.min(suggestionIndex, suggestions.length - 1);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [input]);

  const focusTextareaAt = useCallback((position: number) => {
    window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(position, position);
      setCaret(position);
    });
  }, []);

  const addAttachments = useCallback(
    async (files: FileList | File[]) => {
      setAttachmentError(null);
      try {
        const result = await appendAttachmentFiles(attachments, files);
        setAttachments(result.files);
        setAttachmentError(result.error);
      } catch (err) {
        setAttachmentError(errorMessage(err, "Failed to add attachment"));
      }
    },
    [attachments],
  );

  const selectSuggestion = useCallback(
    (suggestion: ComposerSuggestion) => {
      if (!trigger) return;
      if (suggestion.kind === "slash") {
        const replacement = `${suggestion.command} `;
        const next =
          input.slice(0, trigger.start) + replacement + input.slice(trigger.end);
        setInput(next);
        focusTextareaAt(trigger.start + replacement.length);
        return;
      }

      const next = input.slice(0, trigger.start) + input.slice(trigger.end);
      setInput(next);
      setWorkspaceReferences((current) => {
        if (
          current.some(
            (reference) =>
              reference.kind === suggestion.reference.kind &&
              reference.path === suggestion.reference.path,
          )
        ) {
          return current;
        }
        return [...current, suggestion.reference];
      });
      focusTextareaAt(trigger.start);
    },
    [focusTextareaAt, input, trigger],
  );

  const submit = () => {
    if (!hasSendContent || sendDisabled) return;
    const payload: ComposerSendPayload = {
      text: input.trim(),
      references: workspaceReferences,
      files: attachments,
    };
    void Promise.resolve(onSend(payload)).then((sent) => {
      if (sent) {
        setInput("");
        setWorkspaceReferences([]);
        setAttachments([]);
        setAttachmentError(null);
        setCaret(0);
      }
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestionsOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggestionIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestionIndex((index) =>
          (index - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectSuggestion(suggestions[activeSuggestionIndex] ?? suggestions[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCaret(-1);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    setCaret(event.target.selectionStart);
    setSuggestionIndex(0);
  };

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (files) void addAttachments(files);
    event.currentTarget.value = "";
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.clipboardData.files.length === 0) return;
    event.preventDefault();
    void addAttachments(event.clipboardData.files);
  };

  const onDragEnter = (event: DragEvent<HTMLFormElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDragActive(true);
  };

  const onDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLFormElement>) => {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    setDragActive(false);
  };

  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDragActive(false);
    void addAttachments(event.dataTransfer.files);
  };

  const attachButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn(COMPOSER_ICON_BTN, "text-muted-foreground hover:text-foreground")}
      disabled={disabled}
      aria-label="Attach files"
      onClick={() => fileInputRef.current?.click()}
    >
      <Plus className="size-3.5" />
    </Button>
  );

  const modeSelector = (
    <ModeSelector value={mode} onChange={onModeChange} disabled={disabled} iconOnly={iconOnly} />
  );

  const permissionsDropdown = (
    <PermissionsDropdown
      value={permissionMode}
      onChange={onPermissionModeChange}
      iconOnly={iconOnly}
    />
  );

  const mcpSelector = (
    <McpSelector
      servers={mcpServers}
      selectedIds={selectedMcpServerIds}
      onSelectedIdsChange={onSelectedMcpServerIdsChange}
      disabled={disabled || mode !== "agent" || !project}
      iconOnly={iconOnly}
    />
  );

  const tokenCounter = (
    <TokenCounter tokenUsage={tokenUsage} pending={streaming} />
  );

  const modelPicker = (
    <ModelPicker
      value={model}
      onChange={onModelChange}
      thinkingEnabled={thinkingEnabled}
      onThinkingEnabledChange={onThinkingEnabledChange}
      disabled={streaming}
      triggerClassName={cn(
        MODEL_TRIGGER,
        variant === "compact"
          ? "min-w-0 flex-1"
          : variant === "inline"
            ? "w-32 min-w-0 shrink"
            : "w-40 min-w-0 max-w-48 shrink",
      )}
    />
  );

  const sendButton = streaming ? (
    <Button
      type="button"
      variant="outline"
      size="icon-xs"
      onClick={onStop}
      className={COMPOSER_ICON_BTN}
      aria-label="Stop generation"
    >
      <Square className="fill-current" />
    </Button>
  ) : (
    <Button
      type="submit"
      size="icon-xs"
      disabled={sendDisabled || !hasSendContent}
      className={COMPOSER_ICON_BTN}
      aria-label="Send message"
    >
      <ArrowUp className="size-3.5" />
    </Button>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative z-40 w-full max-w-full shrink-0 overflow-visible bg-background px-3 pb-2 pt-1 sm:px-4"
    >
      <div className="mx-auto w-full max-w-[calc(100vw-1.5rem)] min-w-0 sm:max-w-[720px]">
        <div
          className={cn(
            "rounded-xl bg-card p-3 ring-1 ring-border",
            dragActive && "ring-primary/60",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            tabIndex={-1}
            onChange={onFileInputChange}
          />
          <div className="relative min-w-0">
            <ComposerSuggestionPopover
              suggestions={suggestions}
              activeIndex={activeSuggestionIndex}
              onSelect={selectSuggestion}
            />
            <WorkspaceReferenceTray
              references={workspaceReferences}
              removable
              onRemove={(reference) => {
                setWorkspaceReferences((current) =>
                  current.filter(
                    (item) =>
                      item.kind !== reference.kind || item.path !== reference.path,
                  ),
                );
              }}
              className="mb-2"
            />
            <AttachmentTray
              files={attachments}
              removable
              onRemove={(_file, index) => {
                setAttachments((current) =>
                  current.filter((_item, itemIndex) => itemIndex !== index),
                );
                setAttachmentError(null);
              }}
              className={workspaceReferences.length > 0 ? "mb-2" : "mb-2"}
            />
            {attachmentError || skillsError || fileTreeState.error ? (
              <div className="mb-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11.5px] text-destructive ring-1 ring-destructive/20">
                {attachmentError ?? skillsError ?? fileTreeState.error}
              </div>
            ) : null}
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={onInputChange}
              onClick={(event) => setCaret(event.currentTarget.selectionStart)}
              onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={placeholderForMode(mode)}
              rows={1}
              className="field-sizing-fixed min-h-0 min-w-0 resize-none rounded-none border-0 bg-transparent p-0 font-mono text-[13px] leading-5 shadow-none ring-0 placeholder:font-mono placeholder:text-(--accent-muted) focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent md:text-[13px]"
              style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
            />
          </div>
          {variant === "compact" ? (
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                {attachButton}
                {modeSelector}
                {permissionsDropdown}
                {mcpSelector}
                <div className="min-w-0 flex-1" />
                {sendButton}
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                {tokenCounter}
                {modelPicker}
              </div>
            </div>
          ) : (
            <div className="mt-3 flex min-w-0 items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                {attachButton}
                {modeSelector}
                {permissionsDropdown}
                {mcpSelector}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {tokenCounter}
                {modelPicker}
                {sendButton}
              </div>
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1.5 text-[12.5px] font-medium text-muted-foreground sm:gap-x-4">
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
            compact={compactContext}
            className="max-w-[20rem]"
            contentAlign="start"
          />
          {project?.isGitRepository ? (
            <BranchSwitcher
              project={project}
              currentBranch={projectBranch}
              showProjectName={false}
              className="max-w-[20rem]"
              contentAlign="start"
            />
          ) : null}
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
  iconOnly = false,
}: {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
  disabled: boolean;
  iconOnly?: boolean;
}) {
  const selected = MODE_ITEMS.find((item) => item.value === value) ?? MODE_ITEMS[1];
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as ChatMode)}
      disabled={disabled}
    >
      <SelectTrigger
        className={cn(COMPOSER_CHIP, iconOnly && "px-2")}
        hideChevron={iconOnly}
        aria-label={`Mode: ${selected.label}`}
      >
        <selected.Icon className="size-3 shrink-0 text-muted-foreground" />
        {iconOnly ? (
          <ChevronDown className="size-2.5 shrink-0 opacity-70" />
        ) : (
          <SelectValue>{selected.label}</SelectValue>
        )}
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

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes("Files");
}

function McpSelector({
  servers,
  selectedIds,
  onSelectedIdsChange,
  disabled,
  iconOnly = false,
}: {
  servers: McpServerSummary[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  disabled: boolean;
  iconOnly?: boolean;
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
          className={cn(
            COMPOSER_CHIP,
            selectedCount > 0 && "text-foreground",
            iconOnly && "px-2",
          )}
          disabled={disabled}
          aria-label={`MCP servers, ${selectedCount} enabled`}
        >
          <Server className="size-3 text-muted-foreground" />
          {iconOnly ? selectedCount : `MCP ${selectedCount}`}
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
  iconOnly = false,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  iconOnly?: boolean;
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
          iconOnly && "w-[26px] justify-center px-0",
        )}
        hideChevron={iconOnly}
        aria-label={`Permission mode: ${selected.label}`}
      >
        <selected.Icon
          className={cn(
            "size-3 shrink-0",
            isFullAccessMode ? "text-primary" : "text-muted-foreground",
          )}
        />
        {iconOnly ? null : <SelectValue>{selected.label}</SelectValue>}
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
