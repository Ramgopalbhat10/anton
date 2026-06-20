"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ChatAddToolApproveResponseFunction, FileUIPart } from "ai";
import {
  Check,
  Copy,
  Pencil,
  Play,
  Sparkles,
} from "lucide-react";

import {
  failedToolOutputMessage,
  getAssistantTextDisplay,
  getRunData,
  getToolTraceEntries,
  messageHadSuccessfulStateChangingEdit,
  messageIsLoopGuardIncomplete,
  messageIsUnverifiedEdit,
  messageIsVerificationFailed,
  type AntonUIMessage,
  type AntonWorkspaceReference,
  type AntonWorkspaceReferencePartData,
} from "@/src/lib/trace";
import type { ChatMode } from "@/src/lib/chat-modes";
import { cn } from "@/lib/utils";
import { Surface } from "@/components/shared/surface";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "./markdown";
import {
  messageMetrics,
  type ResponseMetrics,
} from "./message-metrics";
import { ResponseMetricsHoverCard } from "./metrics-hover-card";
import { RunTraceAccordion } from "@/components/features/run-trace/run-trace";
import { isFailedToolOutput } from "@/components/features/run-trace/tool-display";
import { getTodoTraceDisplay } from "@/components/features/run-trace/trace-data";
import {
  AttachmentTray,
  WorkspaceReferenceTray,
} from "./composer-parts";

interface MessageListProps {
  messages: AntonUIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  recovering?: boolean;
  streamingResponseMode?: ChatMode | null;
  onApproval: ChatAddToolApproveResponseFunction;
  onAcceptPlan: (plan: string) => void;
  acceptPlanDisabled?: boolean;
}

export function MessageList({
  messages,
  status,
  recovering = false,
  streamingResponseMode = null,
  onApproval,
  onAcceptPlan,
  acceptPlanDisabled = false,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const todoDisplay = useMemo(() => getTodoTraceDisplay(messages), [messages]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior:
          status === "submitted" || status === "streaming" ? "auto" : "smooth",
      });
    });

    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [messages.length, status]);

  if (messages.length === 0) {
    if (recovering) {
      return (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
          {emptyMessageListText(recovering)}
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-6 text-center">
        <div className="grid size-11 place-items-center rounded-xl border border-border bg-card">
          <Sparkles className="size-[18px] text-primary" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-[15px] font-semibold">Start a new session</h2>
          <p className="mx-auto max-w-[340px] text-[13px] leading-[1.55] text-muted-foreground/80">
            Ask Anton to inspect or change the selected workspace. Pick a
            project and branch below to get started.
          </p>
        </div>
      </div>
    );
  }

  const latestMessage = messages.at(-1);
  const activeAssistantMessageId =
    latestMessage?.role === "assistant" ? latestMessage.id : undefined;

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-3 pt-7 pb-4 sm:px-4 lg:px-6"
    >
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 pb-8">
        {messages.map((message) => (
          <MessageEvent
            key={message.id}
            message={message}
            messageSignature={messageRenderSignature(message)}
            status={
              message.id === activeAssistantMessageId ? status : "ready"
            }
            streamingResponseMode={
              message.id === activeAssistantMessageId
                ? streamingResponseMode
                : null
            }
            todoDisplay={todoDisplay}
            onApproval={onApproval}
            onAcceptPlan={onAcceptPlan}
            acceptPlanDisabled={acceptPlanDisabled}
          />
        ))}
      </div>
    </div>
  );
}

export function emptyMessageListText(recovering: boolean): string {
  return recovering
    ? "Loading session..."
    : "Start a session by asking Anton to inspect or change the selected workspace.";
}

const MessageEvent = memo(MessageEventImpl, (previous, next) => {
  if (previous.message !== next.message) return false;
  if (previous.messageSignature !== next.messageSignature) return false;
  if (previous.status !== next.status) return false;
  if (previous.streamingResponseMode !== next.streamingResponseMode) return false;
  if (previous.onApproval !== next.onApproval) return false;
  if (previous.onAcceptPlan !== next.onAcceptPlan) return false;
  if (previous.acceptPlanDisabled !== next.acceptPlanDisabled) return false;
  if (
    messageHasTodoDataPart(previous.message) &&
    previous.todoDisplay !== next.todoDisplay
  ) {
    return false;
  }
  return true;
});
MessageEvent.displayName = "MessageEvent";

type MessageEventProps = {
  message: AntonUIMessage;
  messageSignature: string;
  status: "submitted" | "streaming" | "ready" | "error";
  streamingResponseMode: ChatMode | null;
  todoDisplay: ReturnType<typeof getTodoTraceDisplay>;
  onApproval: ChatAddToolApproveResponseFunction;
  onAcceptPlan: (plan: string) => void;
  acceptPlanDisabled: boolean;
};

function MessageEventImpl(props: MessageEventProps) {
  const {
    message,
    status,
    streamingResponseMode,
    todoDisplay,
    onApproval,
    onAcceptPlan,
    acceptPlanDisabled,
  } = props;
  const isUser = message.role === "user";
  const streaming = status === "submitted" || status === "streaming";
  const responseKind =
    message.metadata?.responseKind ??
    (!isUser && streaming ? streamingResponseMode ?? undefined : undefined);
  const userText = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n\n")
    .trim();
  const assistantText = !isUser
    ? getAssistantTextDisplay(message, {
        progressOnly:
          responseKind !== "plan" && streaming,
      }).finalText
    : "";
  const assistantFinal = !isUser && isAssistantMessageFinal(message);
  const pendingApproval = !isUser && messageHasPendingApproval(message);
  const failedToolText =
    !isUser && assistantFinal ? toolFailureFallbackText(message) : "";
  const fallbackText = !isUser &&
    assistantText.length === 0 &&
    failedToolText.length === 0 &&
    !pendingApproval &&
    assistantFinal
    ? toolResultFallbackText(message)
    : "";
  const responseText = isUser ? userText : assistantText || fallbackText;
  const responseTime =
    !isUser && assistantFinal ? messageDisplayTime(message) : undefined;
  const metrics = !isUser && assistantFinal ? messageMetrics(message) : undefined;
  const showActions =
    !isUser &&
    responseText.length > 0 &&
    !pendingApproval &&
    assistantFinal &&
    responseKind !== "plan";
  const showPlanCard =
    !isUser &&
    responseKind === "plan" &&
    responseText.length > 0 &&
    assistantFinal &&
    !streaming;
  const hadSuccessfulEdit =
    !isUser && assistantFinal ? messageHadSuccessfulStateChangingEdit(message) : false;
  const incompleteWithoutEdits =
    !isUser && assistantFinal && messageIsLoopGuardIncomplete(message) && !hadSuccessfulEdit;
  const unverifiedWithEdits =
    !isUser && assistantFinal && messageIsUnverifiedEdit(message) && hadSuccessfulEdit;
  const verificationFailedWithEdits =
    !isUser && assistantFinal && messageIsVerificationFailed(message) && hadSuccessfulEdit;
  const showToolFailure =
    !isUser &&
    failedToolText.length > 0 &&
    assistantText.length === 0 &&
    !pendingApproval &&
    assistantFinal &&
    responseKind !== "plan";

  return (
    <div
      className={cn(
        "group/msg flex flex-col gap-1",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "max-w-full text-xs wrap-break-word",
          isUser ? "max-w-[88%]" : "w-full text-foreground",
        )}
      >
        {isUser ? (
          <div className="rounded-[10px] border border-border bg-secondary px-3.5 py-[9px] text-[13px]">
            <UserMessageContent message={message} />
          </div>
        ) : (
          <div>
            <RunTraceAccordion
              message={message}
              status={status}
              todoDisplay={todoDisplay}
              onApproval={onApproval}
            />
            {showPlanCard ? (
              <PlanMessageCard
                markdown={responseText}
                onAccept={onAcceptPlan}
                disabled={!assistantFinal || pendingApproval || acceptPlanDisabled}
              />
            ) : showToolFailure ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive ring-1 ring-destructive/30">
                Tool failed: {failedToolText}
              </div>
            ) : incompleteWithoutEdits && assistantFinal ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive ring-1 ring-destructive/30">
                No changes were written. {failedToolText || "Loop guards stopped the run before a successful edit."}
              </div>
            ) : unverifiedWithEdits && assistantFinal ? (
              <div className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning ring-1 ring-warning/30">
                Edit completed without verification. Run verify before treating this answer as done.
                {responseText.length > 0 ? (
                  <div className="mt-2 opacity-90">
                    <Markdown className="text-xs leading-relaxed">{responseText}</Markdown>
                  </div>
                ) : null}
              </div>
            ) : verificationFailedWithEdits && assistantFinal ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive ring-1 ring-destructive/30">
                Verification failed after edits. Treat this answer as incomplete until the reported verification issue is fixed.
                {responseText.length > 0 ? (
                  <div className="mt-2 opacity-90">
                    <Markdown className="text-xs leading-relaxed">{responseText}</Markdown>
                  </div>
                ) : null}
              </div>
            ) : responseKind === "plan" ? null
            : responseText.length > 0 ? (
              streaming ? (
                <StreamingText text={responseText} />
              ) : (
                <Markdown className="text-[13.5px] leading-[1.65]">
                  {responseText}
                </Markdown>
              )
            ) : null}
          </div>
        )}
      </div>
      {showActions && (
        <MessageActions
          text={responseText}
          responseTime={responseTime}
          metrics={metrics}
        />
      )}
    </div>
  );
}

function StreamingText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap text-[13.5px] leading-[1.65] text-foreground">
      {text}
    </div>
  );
}

function messageHasPendingApproval(message: AntonUIMessage): boolean {
  return message.parts.some(
    (part) =>
      "state" in part &&
      part.state === "approval-requested" &&
      "toolCallId" in part &&
      typeof part.toolCallId === "string",
  );
}

function messageHasTodoDataPart(message: AntonUIMessage): boolean {
  return message.parts.some((part) => part.type === "data-todos");
}

function messageRenderSignature(message: AntonUIMessage): string {
  const part = message.parts.at(-1);
  const metadataStatus = message.metadata?.status ?? "";
  const responseKind = message.metadata?.responseKind ?? "";
  if (!part) return `${message.parts.length}:${metadataStatus}:${responseKind}`;

  const base = `${message.parts.length}:${metadataStatus}:${responseKind}:${part.type}`;
  if (part.type === "text" || part.type === "reasoning") {
    return `${base}:${part.text.length}`;
  }
  if ("state" in part && typeof part.state === "string") {
    const toolCallId =
      "toolCallId" in part && typeof part.toolCallId === "string"
        ? part.toolCallId
        : "";
    return `${base}:${part.state}:${toolCallId}`;
  }
  if (part.type === "data-run") {
    return `${base}:${part.data.status}:${part.data.finishedAt ?? ""}:${part.data.totalTokens ?? ""}`;
  }
  if (part.type === "data-activity") {
    return `${base}:${part.data.id}:${part.data.status}:${part.data.finishedAt ?? ""}:${part.data.durationMs ?? ""}`;
  }
  if (part.type === "data-todos") {
    return `${base}:${part.data.updatedAt}:${part.data.items.map((item) => item.status).join(",")}`;
  }
  return base;
}

function UserMessageContent({ message }: { message: AntonUIMessage }) {
  const textParts = message.parts.filter((part) => part.type === "text");
  const references = message.parts.flatMap((part) =>
    isWorkspaceReferencePart(part) ? part.data.references : [],
  );
  const files = message.parts.filter(isMessageFilePart);

  return (
    <div className="grid min-w-0 gap-2">
      {textParts.map((part, index) => (
        <div key={index} className="whitespace-pre-wrap leading-normal">
          {part.text}
        </div>
      ))}
      <WorkspaceReferenceTray
        references={references}
        className={textParts.length > 0 ? "pt-0.5" : undefined}
      />
      <AttachmentTray files={files} />
    </div>
  );
}

function isMessageFilePart(
  part: AntonUIMessage["parts"][number],
): part is FileUIPart {
  return part.type === "file";
}

function isWorkspaceReferencePart(
  part: AntonUIMessage["parts"][number],
): part is Extract<AntonUIMessage["parts"][number], { type: "data-workspace-reference" }> {
  return (
    part.type === "data-workspace-reference" &&
    isWorkspaceReferenceData(part.data)
  );
}

function isWorkspaceReferenceData(
  data: unknown,
): data is AntonWorkspaceReferencePartData {
  if (!isRecord(data)) return false;
  if (typeof data.projectId !== "string") return false;
  if (!Array.isArray(data.references)) return false;
  return data.references.every(isWorkspaceReference);
}

function isWorkspaceReference(value: unknown): value is AntonWorkspaceReference {
  if (!isRecord(value)) return false;
  return (
    (value.kind === "file" || value.kind === "directory") &&
    typeof value.path === "string" &&
    typeof value.label === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function PlanMessageCard({
  markdown,
  disabled,
  onAccept,
}: {
  markdown: string;
  disabled: boolean;
  onAccept: (plan: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(markdown);
  const current = editing ? draft : markdown;

  return (
    <Surface variant="elevated" className="overflow-hidden">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <div className="min-w-0">
          <div className="flex h-5 items-center text-ui-label">Plan</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              if (!editing) setDraft(markdown);
              setEditing((value) => !value);
            }}
          >
            <Pencil className="size-3" />
            {editing ? "Preview" : "Edit"}
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={disabled || current.trim().length === 0}
            onClick={() => onAccept(current.trim())}
          >
            <Play className="size-3" />
            Accept
          </Button>
        </div>
      </div>
      <div className="p-3">
        {editing ? (
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-72 resize-y font-mono text-xs leading-relaxed"
            aria-label="Edit plan markdown"
          />
        ) : (
          <Markdown className="text-xs leading-relaxed">{current}</Markdown>
        )}
      </div>
    </Surface>
  );
}

function isAssistantMessageFinal(message: AntonUIMessage): boolean {
  const runStatus = getRunData(message)?.status ?? message.metadata?.status;
  return runStatus === undefined || runStatus !== "running";
}

function toolFailureFallbackText(message: AntonUIMessage): string {
  const entries = getToolTraceEntries([message]);
  const failed = entries.findLast((entry) => {
    return (
      entry.state === "output-error" ||
      isFailedToolOutput(entry.output)
    );
  });
  if (!failed) return "";
  return (
    failed.errorText ??
    failedToolOutputMessage(failed.output) ??
    `${failed.name} failed`
  );
}

function toolResultFallbackText(message: AntonUIMessage): string {
  const entries = getToolTraceEntries([message]);
  const lastOutput = entries.findLast(
    (entry) => entry.state === "output-available" && entry.output !== undefined,
  );
  if (!lastOutput) return "";

  if (lastOutput.name === "bash") {
    return bashOutputFallback(lastOutput.output);
  }

  if (typeof lastOutput.output === "string") return lastOutput.output.trim();

  return "";
}

function bashOutputFallback(output: unknown): string {
  if (typeof output !== "object" || output === null) return "";
  const record = output as Record<string, unknown>;
  const stdout = typeof record.stdout === "string" ? record.stdout.trim() : "";
  const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
  if (stdout) return `\`${stdout}\``;
  if (stderr) return `\`${stderr}\``;
  const exitCode = record.exitCode;
  if (typeof exitCode === "number") return `Command exited with code ${exitCode}.`;
  return "";
}

function messageDisplayTime(message: AntonUIMessage): string | undefined {
  const metadata = message.metadata;
  const run = getRunData(message);
  const timestamp = run?.finishedAt ?? metadata?.finishedAt ?? run?.startedAt ?? metadata?.startedAt;
  if (typeof timestamp !== "number") return undefined;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function MessageActions({
  text,
  responseTime,
  metrics,
}: {
  text: string;
  responseTime?: string;
  metrics?: ResponseMetrics;
}) {
  return (
    <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
      <CopyMessageButton text={text} />
      {metrics && <ResponseMetricsHoverCard metrics={metrics} />}
      {responseTime && (
        <span className="px-1 py-0.5 font-mono text-[11px] text-muted-foreground/70">
          {responseTime}
        </span>
      )}
    </div>
  );
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // noop
    }
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      className="h-5 px-1.5 text-[11.5px] normal-case tracking-normal text-muted-foreground/70 hover:text-foreground"
      aria-label={copied ? "Copied" : "Copy message"}
    >
      {copied ? (
        <>
          <Check className="size-3" /> Copied
        </>
      ) : (
        <>
          <Copy className="size-3" /> Copy
        </>
      )}
    </Button>
  );
}
