"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import {
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

import { DEFAULT_MODEL_ID, type ModelId } from "@/src/lib/models";
import type { PermissionMode } from "@/src/agent/permissions";
import type { AntonUIMessage } from "@/src/lib/trace";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageList } from "./message-list";
import { Composer } from "./composer";
import { Worklog } from "./worklog";
import { useSessionStore } from "./session-store";
import { useSidebar } from "./session-sidebar";
import {
  ACTIVE_PROJECT_EVENT,
  isActiveProjectChangeEvent,
  readActiveProjectId,
} from "./active-project";
import type { ProjectSummary } from "@/src/lib/api-types";
import { getJson } from "@/src/lib/client-fetch";
import { SettingsDialog } from "./settings-dialog";

interface ChatProps {
  sessionId?: string;
  initialMessages?: AntonUIMessage[];
  initialModel?: ModelId;
  initialTitle?: string;
  initialTokensTotal?: number;
  initialProjectId?: string | null;
}

export function Chat({
  sessionId: sessionIdProp,
  initialMessages,
  initialModel,
  initialTitle,
  initialTokensTotal = 0,
  initialProjectId = null,
}: ChatProps) {
  const { sessions, refresh } = useSessionStore();
  const sidebar = useSidebar();
  const persistedRef = useRef(sessionIdProp !== undefined);

  const [sessionId] = useState<string>(() => sessionIdProp ?? generateId());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    initialProjectId,
  );
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [worklogOpen, setWorklogOpen] = useState(false);
  const [mobileWorklogOpen, setMobileWorklogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [model, setModel] = useState<ModelId>(
    (initialModel ?? DEFAULT_MODEL_ID) as ModelId,
  );
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("auto-review");
  const effectiveProjectId = initialProjectId ?? activeProjectId;

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
    addToolApprovalResponse,
  } = useChat<AntonUIMessage>({
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => {
      if (!persistedRef.current) {
        persistedRef.current = true;
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", `/s/${sessionId}`);
        }
      }
      void refresh();
    },
  });

  const streaming = status === "streaming" || status === "submitted";
  const headerTitle = initialTitle ?? (sessionIdProp ? "Session" : "New chat");
  const tokensTotal =
    sessions.find((s) => s.id === sessionId)?.tokensTotal ?? initialTokensTotal;

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

  useEffect(() => {
    if (initialProjectId) return;
    const storedProjectId = readActiveProjectId();
    // Local storage is client-only; syncing after mount keeps hydration stable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (storedProjectId) setActiveProjectId(storedProjectId);
  }, [initialProjectId]);

  useEffect(() => {
    const onActiveProjectChange = (event: Event) => {
      if (initialProjectId) return;
      if (isActiveProjectChangeEvent(event)) setActiveProjectId(event.detail);
    };
    window.addEventListener(ACTIVE_PROJECT_EVENT, onActiveProjectChange);
    return () =>
      window.removeEventListener(
        ACTIVE_PROJECT_EVENT,
        onActiveProjectChange,
      );
  }, [initialProjectId]);

  useEffect(() => {
    if (!effectiveProjectId) return;
    const loadProject = async () => {
      try {
        const data = await getJson<{ project: ProjectSummary }>(
          `/api/projects/${effectiveProjectId}`,
        );
        setProject(data.project);
      } catch {
        setProject(null);
      }
    };
    void loadProject();
  }, [effectiveProjectId]);

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

      <div
        className={cn(
          "relative flex min-h-0 max-w-full flex-1 overflow-hidden",
        )}
      >
        <section className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden">
          <MessageList
            messages={messages}
            status={status}
            onApproval={addToolApprovalResponse}
          />

          {messages.length === 0 && !effectiveProjectId && (
            <WorkspaceRequired onOpenSettings={() => setSettingsOpen(true)} />
          )}

          {error && (
            <div className="border-t border-border px-4 py-2 text-xs text-destructive">
              Error: {error.message}
            </div>
          )}

          <Composer
            onSend={(text) => {
              if (!effectiveProjectId) return;
              void sendMessage(
                { text },
                { body: { projectId: effectiveProjectId, model, permissionMode } },
              );
            }}
            onStop={stop}
            disabled={streaming || !effectiveProjectId}
            streaming={streaming}
            model={model}
            onModelChange={setModel}
            tokens={tokensTotal}
            project={project}
            permissionMode={permissionMode}
            onPermissionModeChange={setPermissionMode}
          />
        </section>

        <Worklog
          messages={messages}
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
              messages={messages}
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
    </div>
  );
}

function WorkspaceRequired({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  return (
    <div className="grid w-full max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0 md:hidden"
        onClick={onOpenSettings}
      >
        Settings
      </Button>
      <span className="min-w-0 flex-1 truncate">
        Select or clone a workspace before starting a new agent chat.
      </span>
    </div>
  );
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

