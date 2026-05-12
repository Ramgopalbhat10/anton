"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";

import { DEFAULT_MODEL_ID, type ModelId } from "@/src/lib/models";
import type { PermissionMode } from "@/src/agent/permissions";
import { getRunDataList, type AntonUIMessage } from "@/src/lib/trace";
import type { McpPreflightServer, McpServerSummary } from "@/src/lib/api-types";
import { getJson, jsonHeaders, requestJson } from "@/src/lib/client-fetch";
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
import { generateChatId } from "./chat-utils";
import { WorkspaceRequired } from "./workspace-required";
import { Worklog } from "@/components/features/run-trace/worklog";
import { useSessionStore } from "@/components/features/sessions/session-store";
import { useSidebar } from "@/components/features/sessions/session-sidebar";
import { useActiveProjectIdState } from "@/src/lib/client-state/active-project";
import { useProjectSummary } from "@/components/features/projects/hooks";
import { SettingsDialog } from "@/components/features/settings/settings-dialog";

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

  const [sessionId] = useState<string>(() => sessionIdProp ?? generateChatId());
  const [activeProjectId, setActiveProjectId] = useActiveProjectIdState(
    initialProjectId,
    { listen: initialProjectId === null },
  );
  const [worklogOpen, setWorklogOpen] = useState(false);
  const [mobileWorklogOpen, setMobileWorklogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [restoreVersion, setRestoreVersion] = useState(0);
  const [messageDisplayOverride, setMessageDisplayOverride] = useState<
    AntonUIMessage[] | null
  >(null);
  const [restoringPersistedMessages, setRestoringPersistedMessages] = useState(
    sessionIdProp !== undefined &&
      (initialMessages?.filter(hasVisibleMessageParts).length ?? 0) === 0,
  );
  const [model, setModel] = useState<ModelId>(
    (initialModel ?? DEFAULT_MODEL_ID) as ModelId,
  );
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("auto-review");
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<string[]>([]);
  const [pendingMcpSend, setPendingMcpSend] = useState<{
    text: string;
    mode: "chat" | "plan";
    untrusted: McpPreflightServer[];
  } | null>(null);
  const effectiveProjectId = initialProjectId ?? activeProjectId;
  const project = useProjectSummary(effectiveProjectId);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AntonUIMessage>({
        api: "/api/chat",
        body: () => ({
          sessionId,
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
    addToolApprovalResponse,
  } = useChat<AntonUIMessage>({
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ messages: finishedMessages, isAbort }) => {
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
    },
  });

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
    const restorePersistedMessages = async () => {
      setRestoringPersistedMessages(true);
      try {
        const res = await fetch(`/api/sessions/${sessionIdProp}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: AntonUIMessage[] };
        const persistedMessages = data.messages?.filter(hasVisibleMessageParts);
        if (!cancelled && persistedMessages && persistedMessages.length > 0) {
          setMessages(data.messages ?? persistedMessages);
        }
      } catch {
        // Keep the current local state; the route refresh still has server truth.
      } finally {
        if (!cancelled) setRestoringPersistedMessages(false);
      }
    };

    void restorePersistedMessages();
    return () => {
      cancelled = true;
    };
  }, [messages.length, sessionIdProp, setMessages]);

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
  }, []);

  const sendWithMcp = async (
    text: string,
    mode: "chat" | "plan" = "chat",
  ): Promise<boolean> => {
    if (!effectiveProjectId) return false;
    const selectedIds = selectedMcpServerIds.filter((id) =>
      mcpServers.some((server) => server.id === id && server.enabled),
    );
    const preflight = await requestJson<{
      ok: boolean;
      untrusted: McpPreflightServer[];
    }>("/api/mcp/preflight", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ serverIds: selectedIds }),
    });
    if (!preflight.ok) {
      setPendingMcpSend({ text, mode, untrusted: preflight.untrusted });
      return false;
    }
    void sendMessage(
      { text },
      {
        body: {
          projectId: effectiveProjectId,
          model,
          mode,
          permissionMode,
          enabledMcpServerIds: selectedIds,
        },
      },
    );
    return true;
  };

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
    await sendWithMcp(pending.text, pending.mode);
  };

  const streaming = status === "streaming" || status === "submitted";
  const displayMessages =
    messages.length > 0 ? messages : messageDisplayOverride ?? messages;
  const recoveringMessages =
    restoringPersistedMessages && displayMessages.length === 0;
  const headerTitle = initialTitle ?? (sessionIdProp ? "Session" : "New chat");
  const persistedTokensTotal =
    sessions.find((s) => s.id === sessionId)?.tokensTotal ?? initialTokensTotal;
  const messageTokensTotal = displayMessages.reduce((sum, message) => {
    return sum + getRunDataList(message).reduce((runSum, run) => {
      return typeof run.totalTokens === "number" && Number.isFinite(run.totalTokens)
        ? runSum + run.totalTokens
        : runSum;
    }, 0);
  }, 0);
  const tokensTotal = Math.max(persistedTokensTotal, messageTokensTotal);

  const toggleWorklog = () => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1280px)").matches
    ) {
      setWorklogOpen((open) => !open);
    } else {
      setMobileWorklogOpen((open) => !open);
    }
  };

  return (
    <div className="flex min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-10 w-full max-w-full items-center justify-between gap-2 border-b border-border px-3">
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
          <h1 className="truncate text-xs font-semibold tracking-tight">
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

      <div className="relative flex min-h-0 max-w-full flex-1 overflow-hidden">
        <section className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden">
          <MessageList
            messages={displayMessages}
            status={status}
            recovering={recoveringMessages}
            onApproval={addToolApprovalResponse}
            onAcceptPlan={(plan) => {
              void sendWithMcp(`Implement this accepted plan:\n\n${plan}`, "chat");
            }}
            acceptPlanDisabled={streaming || !effectiveProjectId}
          />

          {displayMessages.length === 0 && !effectiveProjectId && (
            <WorkspaceRequired onOpenSettings={() => setSettingsOpen(true)} />
          )}

          {error && (
            <div className="border-t border-border px-4 py-2 text-xs text-destructive">
              Error: {error.message}
            </div>
          )}

          <Composer
            onSend={sendWithMcp}
            onPlan={(text) => sendWithMcp(text, "plan")}
            onStop={stop}
            disabled={streaming || !effectiveProjectId}
            streaming={streaming}
            model={model}
            onModelChange={setModel}
            tokens={tokensTotal}
            project={project}
            permissionMode={permissionMode}
            onPermissionModeChange={setPermissionMode}
            mcpServers={mcpServers}
            selectedMcpServerIds={selectedMcpServerIds}
            onSelectedMcpServerIdsChange={setSelectedMcpServerIds}
          />
        </section>

        <Worklog
          messages={displayMessages}
          onApproval={addToolApprovalResponse}
          className={cn(
            "hidden shrink-0 overflow-hidden transition-[width] duration-200 ease-out xl:flex",
            worklogOpen ? "xl:w-[420px]" : "xl:w-0 xl:border-l-0",
          )}
        />

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
              messages={displayMessages}
              onApproval={addToolApprovalResponse}
              className="ml-auto h-full w-[min(420px,100%)] border-l"
              onClose={() => setMobileWorklogOpen(false)}
            />
          </div>
        )}
      </div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        activeProjectId={activeProjectId}
        onActiveProjectChange={setActiveProjectId}
        initialSection="workspaces"
      />
      <McpTrustDialog
        pending={pendingMcpSend}
        onClose={() => setPendingMcpSend(null)}
        onApprove={() => void trustAndSend()}
      />
    </div>
  );
}

function McpTrustDialog({
  pending,
  onClose,
  onApprove,
}: {
  pending: { text: string; mode: "chat" | "plan"; untrusted: McpPreflightServer[] } | null;
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
