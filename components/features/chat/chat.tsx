"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type ChatAddToolApproveResponseFunction,
  type ChatRequestOptions,
} from "ai";
import { PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";

import {
  DEFAULT_MODEL_ID,
  isSupportedModelId,
  resolveModelId,
  type ModelId,
} from "@/src/lib/models";
import { CHAT_MODES, DEFAULT_CHAT_MODE, type ChatMode } from "@/src/lib/chat-modes";
import type { PermissionMode } from "@/src/agent/permissions";
import {
  getRunDataList,
  type AntonRunData,
  type AntonUIMessage,
} from "@/src/lib/trace";
import type { McpPreflightServer, McpServerSummary } from "@/src/lib/api-types";
import { getJson, jsonHeaders, requestJson } from "@/src/lib/client-fetch";
import { useWorkspaceAgentDefaults } from "@/components/features/settings/use-workspace-agent-defaults";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageList } from "./message-list";
import { Composer } from "./composer";
import type { ComposerSendPayload } from "./composer-context";
import { sessionTokenUsage } from "./message-metrics";
import { generateChatId } from "./chat-utils";
import { Worklog } from "@/components/features/run-trace/worklog";
import { WorklogResizeHandle } from "@/components/features/run-trace/worklog-resize-handle";
import { useWorklogWidth } from "@/components/features/run-trace/use-worklog-width";
import { useSessionStore } from "@/components/features/sessions/session-store";
import { useSidebar } from "@/components/features/sessions/session-sidebar";
import {
  useProjectGitStatus,
  useProjectCommands,
  useProjectSummary,
  useProjectsList,
  notifyOpenWorklogStatus,
  notifyProjectStatusChanged,
} from "@/components/features/projects/hooks";

interface ChatProps {
  sessionId?: string;
  initialMessages?: AntonUIMessage[];
  initialModel?: ModelId;
  initialTitle?: string;
  initialTokensTotal?: number;
  initialProjectId?: string | null;
}

export function Chat(props: ChatProps) {
  return <ChatSession key={props.sessionId ?? "new-chat"} {...props} />;
}

type ComposerControlState = {
  mode: ChatMode;
  model: ModelId;
  permissionMode: PermissionMode;
  thinkingEnabled: boolean;
  selectedMcpServerIds?: string[];
};

const composerControlStateBySession = new Map<string, ComposerControlState>();
const COMPOSER_CONTROLS_STORAGE_PREFIX = "anton:composer-controls:";
const PROFILE_HANDOFF_STORAGE_PREFIX = "anton:profile-handoff-started:";
const PERMISSION_MODES = ["default", "auto-review", "full-access"] as const;
const WORKLOG_OPEN_STORAGE_KEY = "anton-worklog-open";
const WORKLOG_OPEN_CHANGE_EVENT = "anton-worklog-open-change";

function readStoredWorklogOpen(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(WORKLOG_OPEN_STORAGE_KEY) === "1";
}

function subscribeStoredWorklogOpen(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === WORKLOG_OPEN_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(WORKLOG_OPEN_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(WORKLOG_OPEN_CHANGE_EVENT, onStoreChange);
  };
}

function writeStoredWorklogOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(WORKLOG_OPEN_STORAGE_KEY, open ? "1" : "0");
  window.dispatchEvent(new Event(WORKLOG_OPEN_CHANGE_EVENT));
}

function ChatSession({
  sessionId: sessionIdProp,
  initialMessages,
  initialModel,
  initialTitle,
  initialTokensTotal = 0,
  initialProjectId = null,
}: ChatProps) {
  const router = useRouter();
  const { sessions, refresh } = useSessionStore();
  const sidebar = useSidebar();
  const persistedRef = useRef(sessionIdProp !== undefined);
  const lastNonEmptyMessagesRef = useRef<AntonUIMessage[]>(
    initialMessages?.filter(hasVisibleMessageParts) ?? [],
  );
  const restoreMessagesRef = useRef<AntonUIMessage[] | null>(null);
  const resumeAttemptedRef = useRef(false);

  const [sessionId] = useState<string>(() => sessionIdProp ?? generateChatId());
  const profileHandoffStartedRef = useRef<Set<string>>(
    readStartedProfileHandoffRunIds(sessionId),
  );
  const isDraftSession = sessionIdProp === undefined;
  const workspaceDefaults = useWorkspaceAgentDefaults();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const {
    readyProjects,
    loading: projectsLoading,
    error: projectsError,
    refresh: refreshProjects,
  } = useProjectsList();
  const initialControls = useMemo(
    () => composerControlStateBySession.get(sessionId),
    [sessionId],
  );
  const worklogOpen = useSyncExternalStore(
    subscribeStoredWorklogOpen,
    readStoredWorklogOpen,
    () => false,
  );
  const setWorklogOpen = useCallback(
    (nextValue: boolean | ((open: boolean) => boolean)) => {
      const currentValue = readStoredWorklogOpen();
      writeStoredWorklogOpen(
        typeof nextValue === "function" ? nextValue(currentValue) : nextValue,
      );
    },
    [],
  );
  const [mobileWorklogOpen, setMobileWorklogOpen] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const chatColumnRef = useRef<HTMLElement>(null);
  const [chatColumnWidth, setChatColumnWidth] = useState(0);
  const {
    width: worklogWidth,
    expanded: worklogExpanded,
    isResizing: worklogResizing,
    setToMax: expandWorklog,
    toggleExpanded: toggleWorklogExpanded,
    startResize: startWorklogResize,
  } = useWorklogWidth(layoutRef);

  useLayoutEffect(() => {
    const element = chatColumnRef.current;
    if (!element) return;

    const update = () => {
      setChatColumnWidth(element.getBoundingClientRect().width);
    };

    update();
    const observer = new ResizeObserver(() => {
      update();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const [restoreVersion, setRestoreVersion] = useState(0);
  const [messageDisplayOverride, setMessageDisplayOverride] = useState<
    AntonUIMessage[] | null
  >(null);
  const [restoringPersistedMessages, setRestoringPersistedMessages] = useState(
    sessionIdProp !== undefined &&
      (initialMessages?.filter(hasVisibleMessageParts).length ?? 0) === 0,
  );
  const [model, setModel] = useState<ModelId>(
    initialControls?.model ?? ((initialModel ?? DEFAULT_MODEL_ID) as ModelId),
  );
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    initialControls?.permissionMode ?? "auto-review",
  );
  const [mode, setMode] = useState<ChatMode>(
    initialControls?.mode ?? DEFAULT_CHAT_MODE,
  );
  const [thinkingEnabled, setThinkingEnabled] = useState(
    initialControls?.thinkingEnabled ?? false,
  );
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<string[]>(
    initialControls?.selectedMcpServerIds ?? [],
  );
  const [pendingMcpSend, setPendingMcpSend] = useState<{
    payload: ComposerSendPayload;
    mode: ChatMode;
    untrusted: McpPreflightServer[];
  } | null>(null);
  const [streamingResponseMode, setStreamingResponseMode] = useState<ChatMode | null>(
    null,
  );
  const effectiveProjectId = initialProjectId ?? selectedProjectId;
  const project = useProjectSummary(effectiveProjectId);
  const projectGitStatus = useProjectGitStatus(project ? effectiveProjectId : null);
  const projectCommands = useProjectCommands(
    project?.status === "ready" ? project.id : null,
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AntonUIMessage>({
        api: "/api/chat",
        body: () => ({
          sessionId,
        }),
        prepareReconnectToStreamRequest: ({ id }) => ({
          api: `/api/chat/resume?sessionId=${encodeURIComponent(id)}`,
        }),
      }),
    [sessionId],
  );

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    setMessages,
    resumeStream,
    addToolApprovalResponse,
  } = useChat<AntonUIMessage>({
    id: sessionId,
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ messages: finishedMessages, isAbort }) => {
      setStreamingResponseMode(null);
      const visibleMessages = finishedMessages.filter(hasVisibleMessageParts);
      if (visibleMessages.length > 0) {
        lastNonEmptyMessagesRef.current = visibleMessages;
        setMessageDisplayOverride(null);
      } else if (isAbort && lastNonEmptyMessagesRef.current.length > 0) {
        setMessageDisplayOverride(lastNonEmptyMessagesRef.current);
        restoreMessagesRef.current = lastNonEmptyMessagesRef.current;
        setRestoreVersion((version) => version + 1);
      }

      if (!persistedRef.current) {
        persistedRef.current = true;
        router.replace(`/s/${sessionId}`);
      }
      void refresh();
      if (effectiveProjectId) {
        notifyProjectStatusChanged(effectiveProjectId);
      }
    },
  });
  const previousStatusRef = useRef(status);

  const restorePersistedMessages = useCallback(async (
    options: { isCancelled?: () => boolean } = {},
  ) => {
    if (!sessionIdProp) return;
    const res = await fetch(`/api/sessions/${sessionIdProp}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { messages?: AntonUIMessage[] };
    if (options.isCancelled?.()) return;
    const persistedMessages = data.messages?.filter(hasVisibleMessageParts);
    if (persistedMessages && persistedMessages.length > 0) {
      setMessages(data.messages ?? persistedMessages);
      lastNonEmptyMessagesRef.current = persistedMessages;
      setMessageDisplayOverride(null);
    }
  }, [sessionIdProp, setMessages]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;
    if (
      sessionIdProp &&
      status === "ready" &&
      (previousStatus === "submitted" || previousStatus === "streaming")
    ) {
      void restorePersistedMessages().catch(() => undefined);
    }
  }, [restorePersistedMessages, sessionIdProp, status]);

  useEffect(() => {
    const visibleMessages = messages.filter(hasVisibleMessageParts);
    if (visibleMessages.length > 0) {
      lastNonEmptyMessagesRef.current = visibleMessages;
    }
  }, [messages]);

  useEffect(() => {
    const messagesToRestore = restoreMessagesRef.current;
    if (!messagesToRestore) return;
    restoreMessagesRef.current = null;
    setMessages(messagesToRestore);
  }, [restoreVersion, setMessages]);

  useEffect(() => {
    if (!sessionIdProp || messages.length > 0) return;

    let cancelled = false;
    const restoreInitialPersistedMessages = async () => {
      setRestoringPersistedMessages(true);
      try {
        await restorePersistedMessages({ isCancelled: () => cancelled });
      } catch {
        // Keep the current local state; the route refresh still has server truth.
      } finally {
        if (!cancelled) setRestoringPersistedMessages(false);
      }
    };

    void restoreInitialPersistedMessages();
    return () => {
      cancelled = true;
    };
  }, [messages.length, restorePersistedMessages, sessionIdProp]);

  useEffect(() => {
    if (resumeAttemptedRef.current || !sessionIdProp) return;
    resumeAttemptedRef.current = true;
    void resumeStream();
  }, [resumeStream, sessionIdProp]);

  useEffect(() => {
    if (!isDraftSession) {
      const storedControls = readStoredComposerControlState(sessionId);
      if (!storedControls) return;
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        setMode(storedControls.mode);
        setModel(storedControls.model);
        setPermissionMode(storedControls.permissionMode);
        setThinkingEnabled(storedControls.thinkingEnabled);
        if (storedControls.selectedMcpServerIds) {
          setSelectedMcpServerIds(storedControls.selectedMcpServerIds);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [isDraftSession, sessionId]);

  useEffect(() => {
    if (!isDraftSession || !workspaceDefaults) return;
    queueMicrotask(() => {
      setModel(workspaceDefaults.model);
      setPermissionMode(workspaceDefaults.permissionMode);
    });
  }, [isDraftSession, workspaceDefaults]);

  useEffect(() => {
    let cancelled = false;
    const loadMcpServers = async () => {
      try {
        const data = await getJson<{ servers: McpServerSummary[] }>(
          "/api/mcp/servers",
        );
        if (cancelled) return;
        setMcpServers(data.servers);
        setSelectedMcpServerIds((current) => {
          if (current.length > 0) return current;
          const cachedIds = composerControlStateBySession.get(sessionId)?.selectedMcpServerIds;
          if (cachedIds !== undefined) {
            return cachedIds.filter((id) =>
              data.servers.some((server) => server.id === id && server.enabled),
            );
          }
          return data.servers
            .filter((server) => server.enabled)
            .map((server) => server.id);
        });
      } catch {
        if (!cancelled) setMcpServers([]);
      }
    };
    void loadMcpServers();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const persistComposerControls = useCallback((controls: ComposerControlState) => {
    composerControlStateBySession.set(sessionId, controls);
    if (!isDraftSession || persistedRef.current) {
      writeStoredComposerControlState(sessionId, controls);
    }
  }, [isDraftSession, sessionId]);

  const currentComposerControls = useCallback(
    (nextMode: ChatMode = mode): ComposerControlState => ({
      mode: nextMode,
      model,
      permissionMode,
      thinkingEnabled,
      selectedMcpServerIds,
    }),
    [
      mode,
      model,
      permissionMode,
      selectedMcpServerIds,
      thinkingEnabled,
    ],
  );

  const setModeAndPersist = useCallback(
    (nextMode: ChatMode) => {
      setMode(nextMode);
      persistComposerControls(currentComposerControls(nextMode));
    },
    [currentComposerControls, persistComposerControls],
  );

  useEffect(() => {
    persistComposerControls(currentComposerControls());
  }, [
    currentComposerControls,
    persistComposerControls,
  ]);

  const selectedEnabledMcpServerIds = useCallback(() => (
    selectedMcpServerIds.filter((id) =>
      mcpServers.some((server) => server.id === id && server.enabled),
    )
  ), [mcpServers, selectedMcpServerIds]);

  const requestBodyForMode = useCallback(
    (requestedMode: ChatMode): ChatRequestOptions["body"] => ({
      projectId: effectiveProjectId,
      model,
      mode: requestedMode,
      thinkingEnabled,
      permissionMode,
      enabledMcpServerIds:
        requestedMode === "agent" ? selectedEnabledMcpServerIds() : [],
    }),
    [
      effectiveProjectId,
      model,
      permissionMode,
      selectedEnabledMcpServerIds,
      thinkingEnabled,
    ],
  );

  const approveTool = useCallback<ChatAddToolApproveResponseFunction>(
    (response) =>
      addToolApprovalResponse({
        ...response,
        options: {
          ...response.options,
          body: {
            ...requestBodyForMode(mode),
            ...asRecord(response.options?.body),
          },
        },
      }),
    [addToolApprovalResponse, mode, requestBodyForMode],
  );

  useEffect(() => {
    if (status !== "ready") return;
    const handoffRun = latestPendingProfileHandoffRun(messages);
    if (!handoffRun) return;
    if (profileHandoffStartedRef.current.has(handoffRun.runId)) return;

    profileHandoffStartedRef.current.add(handoffRun.runId);
    writeStartedProfileHandoffRunIds(
      sessionId,
      profileHandoffStartedRef.current,
    );
    if (lastNonEmptyMessagesRef.current.length > 0) {
      setMessageDisplayOverride(lastNonEmptyMessagesRef.current);
    }
    setStreamingResponseMode("agent");
    void sendMessage(undefined, {
      body: {
        ...requestBodyForMode("agent"),
        continueProfileHandoff: { runId: handoffRun.runId },
      },
    });
  }, [messages, requestBodyForMode, sendMessage, sessionId, status]);

  const sendWithMcp = useCallback(async (
    payload: ComposerSendPayload,
    requestedMode: ChatMode = mode,
  ): Promise<boolean> => {
    if (requestedMode !== "chat" && !effectiveProjectId) return false;
    if (payload.references.length > 0 && !effectiveProjectId) return false;
    const includeMcp =
      requestedMode === "agent" && !isAcceptedPlanRequest(payload.text);
    const selectedIds = includeMcp
      ? selectedEnabledMcpServerIds()
      : [];
    if (selectedIds.length > 0) {
      const preflight = await requestJson<{
        ok: boolean;
        untrusted: McpPreflightServer[];
      }>("/api/mcp/preflight", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ serverIds: selectedIds }),
      });
      if (!preflight.ok) {
        setPendingMcpSend({
          payload,
          mode: requestedMode,
          untrusted: preflight.untrusted,
        });
        return false;
      }
    }
    if (lastNonEmptyMessagesRef.current.length > 0) {
      setMessageDisplayOverride(lastNonEmptyMessagesRef.current);
    }
    setStreamingResponseMode(requestedMode);
    void sendMessage(
      composerPayloadToMessage(payload, effectiveProjectId),
      {
        body: {
          ...requestBodyForMode(requestedMode),
          enabledMcpServerIds: selectedIds,
        },
      },
    );
    return true;
  }, [
    effectiveProjectId,
    mode,
    requestBodyForMode,
    selectedEnabledMcpServerIds,
    sendMessage,
  ]);

  const trustAndSend = async () => {
    if (!pendingMcpSend) return;
    const pending = pendingMcpSend;
    for (const server of pending.untrusted) {
      await requestJson<{ server: McpServerSummary }>("/api/mcp/trust", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          serverId: server.id,
          fingerprint: server.trust.fingerprint,
          approved: true,
        }),
      });
    }
    setPendingMcpSend(null);
    await sendWithMcp(pending.payload, pending.mode);
  };

  const streaming = status === "streaming" || status === "submitted";
  const displayMessages = displayMessagesForRender({
    current: messages,
    fallback: messageDisplayOverride,
    streaming,
  });
  const deferredDisplayMessages = useDeferredValue(displayMessages);
  const worklogMessages = streaming ? deferredDisplayMessages : displayMessages;
  const projectLocked =
    initialProjectId !== null || displayMessages.length > 0;
  const recoveringMessages =
    restoringPersistedMessages && displayMessages.length === 0;
  const headerTitle = initialTitle ?? (sessionIdProp ? "Session" : "New chat");
  const persistedTokensTotal =
    sessions.find((s) => s.id === sessionId)?.tokensTotal ?? initialTokensTotal;
  const tokenUsage = sessionTokenUsage(displayMessages, persistedTokensTotal);

  const handleAcceptPlan = useCallback(() => {
    setModeAndPersist("agent");
    void sendWithMcp(
      { text: "Implement plan", references: [], files: [] },
      "agent",
    );
  }, [sendWithMcp, setModeAndPersist]);

  const toggleWorklog = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1280px)").matches
    ) {
      setWorklogOpen((open) => !open);
    } else {
      setMobileWorklogOpen((open) => !open);
    }
  }, [setWorklogOpen]);

  const openProjectStatus = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1280px)").matches
    ) {
      setWorklogOpen(true);
    } else {
      setMobileWorklogOpen(true);
    }
    notifyOpenWorklogStatus();
  }, [setWorklogOpen]);

  const openWorklogFile = useCallback(() => {
    sidebar.setOpen(false);
    expandWorklog();
    setWorklogOpen(true);
  }, [expandWorklog, setWorklogOpen, sidebar]);

  const closeMobileWorklogFile = useCallback(() => {
    setMobileWorklogOpen(false);
  }, []);

  return (
    <div className="flex min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-11 w-full max-w-full items-center justify-between gap-2 border-b border-layout-border px-3 md:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {!sidebar.open && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="hidden md:inline-flex"
              onClick={sidebar.toggle}
              aria-label="Open sidebar"
              aria-pressed={sidebar.open}
            >
              <PanelLeftOpen />
            </Button>
          )}
          <h1 className="truncate text-[13px] font-medium">
            {headerTitle}
          </h1>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={toggleWorklog}
            aria-label="Toggle worklog"
            aria-pressed={worklogOpen || mobileWorklogOpen}
          >
            {worklogOpen || mobileWorklogOpen ? (
              <PanelRightClose />
            ) : (
              <PanelRightOpen />
            )}
          </Button>
        </div>
      </header>

      <div
        ref={layoutRef}
        className="relative flex min-h-0 max-w-full flex-1 overflow-hidden"
      >
        <section
          ref={chatColumnRef}
          className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden"
        >
          <MessageList
            messages={displayMessages}
            status={status}
            recovering={recoveringMessages}
            streamingResponseMode={streaming ? streamingResponseMode : null}
            onApproval={approveTool}
            onAcceptPlan={handleAcceptPlan}
            acceptPlanDisabled={streaming || !effectiveProjectId}
          />

          {error && (
            <div className="border-t border-border px-4 py-2 text-xs text-destructive">
              Error: {error.message}
            </div>
          )}

          <Composer
            onSend={sendWithMcp}
            onStop={stop}
            disabled={streaming}
            streaming={streaming}
            mode={mode}
            onModeChange={setModeAndPersist}
            model={model}
            onModelChange={setModel}
            thinkingEnabled={thinkingEnabled}
            onThinkingEnabledChange={setThinkingEnabled}
            tokenUsage={tokenUsage}
            project={project}
            projectBranch={projectGitStatus?.branch ?? null}
            readyProjects={readyProjects}
            projectsLoading={projectsLoading}
            projectsError={projectsError}
            selectedProjectId={effectiveProjectId}
            onSelectedProjectIdChange={setSelectedProjectId}
            projectLocked={projectLocked}
            onRefreshProjects={() => void refreshProjects()}
            permissionMode={permissionMode}
            onPermissionModeChange={setPermissionMode}
            mcpServers={mcpServers}
            selectedMcpServerIds={selectedMcpServerIds}
            onSelectedMcpServerIdsChange={setSelectedMcpServerIds}
            runningCommandCount={projectCommands.runningCount}
            onOpenProjectStatus={openProjectStatus}
            columnWidth={chatColumnWidth}
            worklogOpen={worklogOpen}
          />
        </section>

        <div
          className={cn(
            "relative hidden shrink-0 overflow-hidden xl:block",
            !worklogResizing && "transition-[width] duration-200 ease-in-out",
            !worklogOpen && "pointer-events-none xl:border-l-0",
          )}
          style={{ width: worklogOpen ? worklogWidth : 0 }}
        >
          <div
            className={cn(
              "relative h-full",
              !worklogResizing &&
                worklogOpen &&
                "transition-[width] duration-200 ease-in-out",
            )}
            style={{ width: worklogWidth }}
          >
            {worklogOpen ? (
              <WorklogResizeHandle
                onResizeStart={startWorklogResize}
                active={worklogResizing}
              />
            ) : null}
            <Worklog
              messages={worklogMessages}
              streaming={streaming}
              onApproval={approveTool}
              project={project}
              visible={worklogOpen}
              expanded={worklogExpanded}
              onFileOpen={openWorklogFile}
              onExpandToggle={toggleWorklogExpanded}
              className="h-full w-full min-w-0"
            />
          </div>
        </div>

        {mobileWorklogOpen && (
          <div
            className="absolute inset-0 z-30 bg-background/70 backdrop-blur-sm xl:hidden"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setMobileWorklogOpen(false);
              }
            }}
          >
            <Worklog
              messages={worklogMessages}
              streaming={streaming}
              onApproval={approveTool}
              project={project}
              visible
              className="ml-auto h-full w-[min(420px,100%)] border-l"
              onClose={closeMobileWorklogFile}
              onFileOpen={closeMobileWorklogFile}
            />
          </div>
        )}
      </div>
      <McpTrustDialog
        pending={pendingMcpSend}
        onClose={() => setPendingMcpSend(null)}
        onApprove={() => void trustAndSend()}
      />
    </div>
  );
}

function isAcceptedPlanRequest(text: string): boolean {
  return text.trim().toLowerCase() === "implement plan";
}

function composerPayloadToMessage(
  payload: ComposerSendPayload,
  projectId: string | null,
): { role: "user"; parts: AntonUIMessage["parts"] } {
  const parts: AntonUIMessage["parts"] = [];
  if (payload.text.trim().length > 0) {
    parts.push({ type: "text", text: payload.text.trim() });
  }
  if (payload.references.length > 0 && projectId) {
    parts.push({
      type: "data-workspace-reference",
      id: `workspace-reference-${generateChatId()}`,
      data: {
        projectId,
        references: payload.references,
      },
    });
  }
  parts.push(...payload.files);
  return { role: "user", parts };
}

function composerControlsStorageKey(sessionId: string): string {
  return `${COMPOSER_CONTROLS_STORAGE_PREFIX}${sessionId}`;
}

function readStoredComposerControlState(
  sessionId: string,
): ComposerControlState | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(composerControlsStorageKey(sessionId));
  if (!raw) return undefined;
  const parsed = parseJsonRecord(raw);
  if (!parsed) return undefined;
  const mode = readChatMode(parsed.mode);
  const model = readModelId(parsed.model);
  const permissionMode = readPermissionMode(parsed.permissionMode);
  if (!mode || !model || !permissionMode) return undefined;
  return {
    mode,
    model,
    permissionMode,
    thinkingEnabled: parsed.thinkingEnabled === true,
    selectedMcpServerIds: readStringArray(parsed.selectedMcpServerIds),
  };
}

function writeStoredComposerControlState(
  sessionId: string,
  controls: ComposerControlState,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    composerControlsStorageKey(sessionId),
    JSON.stringify(controls),
  );
}

function profileHandoffStorageKey(sessionId: string): string {
  return `${PROFILE_HANDOFF_STORAGE_PREFIX}${sessionId}`;
}

function readStartedProfileHandoffRunIds(sessionId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  const raw = window.sessionStorage.getItem(profileHandoffStorageKey(sessionId));
  if (!raw) return new Set();
  const parsed = parseJsonRecord(raw);
  const runIds = readStringArray(parsed?.runIds);
  return new Set(runIds ?? []);
}

function writeStartedProfileHandoffRunIds(
  sessionId: string,
  runIds: ReadonlySet<string>,
): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    profileHandoffStorageKey(sessionId),
    JSON.stringify({ runIds: Array.from(runIds) }),
  );
}

function latestPendingProfileHandoffRun(
  messages: AntonUIMessage[],
): AntonRunData | undefined {
  const latestAssistant = messages.findLast(
    (message) => message.role === "assistant",
  );
  if (!latestAssistant) return undefined;
  const runs = getRunDataList(latestAssistant);
  const handoffRun = runs.findLast((run) => {
    return (
      run.status === "completed" &&
      run.finishReason === "profile_handoff_required" &&
      run.profileHandoffRequired === true &&
      (run.handoffFromProfile === "localized-edit" ||
        run.handoffFromProfile === "single-file-edit") &&
      run.handoffToProfile === "general-chat"
    );
  });
  if (!handoffRun) return undefined;
  const hasLaterSegment = runs.some((run) => {
    return run.runId !== handoffRun.runId && run.startedAt > handoffRun.startedAt;
  });
  return hasLaterSegment ? undefined : handoffRun;
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readChatMode(value: unknown): ChatMode | undefined {
  return typeof value === "string" && CHAT_MODES.includes(value as ChatMode)
    ? value as ChatMode
    : undefined;
}

function readModelId(value: unknown): ModelId | undefined {
  return typeof value === "string" && isSupportedModelId(value)
    ? resolveModelId(value)
    : undefined;
}

function readPermissionMode(value: unknown): PermissionMode | undefined {
  return typeof value === "string" &&
    PERMISSION_MODES.includes(value as PermissionMode)
    ? value as PermissionMode
    : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

function McpTrustDialog({
  pending,
  onClose,
  onApprove,
}: {
  pending: {
    payload: ComposerSendPayload;
    mode: ChatMode;
    untrusted: McpPreflightServer[];
  } | null;
  onClose: () => void;
  onApprove: () => void;
}) {
  const first = pending?.untrusted[0];
  return (
    <AlertDialog open={pending !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pending && pending.untrusted.length > 1
              ? `Trust ${pending.untrusted.length} MCP servers`
              : first?.trust.approval.title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pending && pending.untrusted.length > 1
              ? "Anton needs startup approval before connecting to these MCP servers."
              : first?.trust.approval.summary}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-64 overflow-auto">
          {pending?.untrusted.map((server) => (
            <div key={server.id} className="mb-3 last:mb-0">
              <div className="text-xs font-medium">{server.displayName}</div>
              <ul className="mt-1 grid gap-1 text-xs text-muted-foreground">
                {server.trust.approval.details.map((detail) => (
                  <li key={detail} className="break-words">
                    {detail}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onApprove}>Trust and send</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function hasVisibleMessageParts(message: AntonUIMessage): boolean {
  return message.parts.some((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return part.text.trim().length > 0;
    }
    return part.type !== "step-start";
  });
}

function displayMessagesForRender({
  current,
  fallback,
  streaming,
}: {
  current: AntonUIMessage[];
  fallback: AntonUIMessage[] | null;
  streaming: boolean;
}): AntonUIMessage[] {
  if (current.length === 0) return fallback ?? current;
  if (!streaming || !fallback || fallback.length === 0) return current;

  const currentIds = new Set(current.map((message) => message.id));
  const fallbackIds = new Set(fallback.map((message) => message.id));
  const retainedHistory = fallback.every((message) => currentIds.has(message.id));
  if (retainedHistory) return current;

  return [
    ...fallback,
    ...current.filter((message) => !fallbackIds.has(message.id)),
  ];
}
