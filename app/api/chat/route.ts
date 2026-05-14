import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  getToolName,
  isToolUIPart,
  type FinishReason,
  type LanguageModelUsage,
  type ProviderMetadata,
  type TextStreamPart,
  type ToolSet,
  type UIMessageStreamWriter,
} from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  runAgent,
  type AgentRunProfile,
  type TokenAudit,
} from "@/src/agent/loop";
import {
  buildToolApprovalMetadata,
  getNativeToolPermissionMetadata,
  isMcpTool,
  preClassifyBashInput,
  type PermissionMode,
} from "@/src/agent/permissions";
import { bashProgress } from "@/src/lib/bash-stream";
import {
  addSessionTokens,
  createRun,
  createSession,
  deriveTitleFromMessages,
  getActiveRunForSession,
  getMessagePersistenceConflict,
  getProject,
  getSession,
  getToolCall,
  MessagePersistenceConflictError,
  saveMessagesIncrementally,
  setSessionProject,
  touchSession,
  updateRun,
  updateToolCall,
  upsertToolApproval,
  upsertToolCall,
  upsertRunEvent,
} from "@/src/db/queries";
import { DEFAULT_MODEL } from "@/src/lib/providers";
import { isSupportedModelId } from "@/src/lib/models";
import { redactText, redactValue } from "@/src/lib/redaction";
import {
  collapseAssistantContinuationMessages,
  getApprovalMetadata,
  getToolTraceEntries,
  isRunDataPart,
} from "@/src/lib/trace";
import type {
  AntonActivityEvent,
  AntonActivityKind,
  AntonActivityStatus,
  AntonMessageMetadata,
  AntonRunData,
  AntonRunStatus,
  AntonTodoItem,
  AntonTodoSnapshot,
  AntonUIMessage,
} from "@/src/lib/trace";

export const runtime = "nodejs";
export const maxDuration = 120;
const ACTIVE_RUN_STALE_AFTER_MS = 5 * 60 * 1000;

const bodySchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  model: z.string().min(1).optional(),
  permissionMode: z.enum(["default", "auto-review", "full-access"]).optional(),
  enabledMcpServerIds: z.array(z.string().min(1)).optional(),
  mode: z.enum(["chat", "plan"]).optional(),
  messages: z.array(z.unknown()).min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { sessionId } = parsed.data;
  const mode = parsed.data.mode ?? "chat";
  const uiMessages = parsed.data.messages as AntonUIMessage[];
  const profile = runProfileForMessages(mode, uiMessages);
  const requestBodyBytes = byteLength(JSON.stringify(json ?? {}));
  const model = parsed.data.model ?? DEFAULT_MODEL;
  if (!isSupportedModelId(model)) {
    return Response.json(
      { error: "unsupported model", model },
      { status: 400 },
    );
  }

  const existing = getSession(sessionId);
  const projectId = existing?.projectId ?? parsed.data.projectId ?? null;
  if (!projectId) {
    return Response.json(
      { error: "projectId is required for agent chat sessions" },
      { status: 400 },
    );
  }

  const project = getProject(projectId);
  if (!project || project.status !== "ready") {
    return Response.json(
      { error: "project not found or not ready" },
      { status: 400 },
    );
  }

  if (!existing) {
    createSession({
      id: sessionId,
      title: deriveTitleFromMessages(uiMessages),
      model,
      projectId,
    });
  } else {
    const incomingHistory = uiMessages.filter(hasSubstantiveHistoryParts);
    const approvalContinuation = isToolApprovalContinuation(incomingHistory);
    const conflict = getMessagePersistenceConflict(sessionId, incomingHistory, {
      mutableTailCount: approvalContinuation ? 1 : 0,
      allowExtraAssistantTail: approvalContinuation,
    });
    if (conflict) {
      return Response.json(
        {
          error: "session message history changed; refresh before sending again",
          storedCount: conflict.storedCount,
          incomingCount: conflict.incomingCount,
        },
        { status: 409 },
      );
    }

    const activeRun = getActiveRunForSession(
      sessionId,
      ACTIVE_RUN_STALE_AFTER_MS,
    );
    if (activeRun) {
      return Response.json(
        {
          error: "session already has a running agent turn",
          runId: activeRun.id,
        },
        { status: 409 },
      );
    }

    if (!existing.projectId && projectId) {
      setSessionProject(sessionId, projectId);
    }
    if (existing.model !== model) {
      touchSession(sessionId, model);
    }
  }

  const runId = randomUUID();
  const startedAt = Date.now();
  createRun({
    id: runId,
    sessionId,
    model,
    provider: "openrouter",
    status: "running",
    startedAt: new Date(startedAt),
    stepCount: 0,
  });

  const preparedMessages = prepareMessagesForModel(uiMessages, profile);
  const modelMessages = await convertMessagesForRun(
    preparedMessages,
    runId,
    startedAt,
  );

  const stream = createUIMessageStream<AntonUIMessage>({
    originalMessages: uiMessages,
    execute: async ({ writer }) => {
      const trace = createTraceWriter({
        writer,
        runId,
        model,
        startedAt,
        workspaceRoot: project.localPath,
        responseKind: mode === "plan" ? "plan" : undefined,
      });
      trace.writeRun("running");

      try {
        const result = await runAgent({
          messages: modelMessages,
          model,
          workspaceRoot: project.localPath,
          mode,
          profile,
          requestBodyBytes,
          permissionMode: parsed.data.permissionMode as
            | PermissionMode
            | undefined,
          enabledMcpServerIds: parsed.data.enabledMcpServerIds,
          onStepStart: ({ stepNumber }) => trace.startStep(stepNumber),
          onStepFinish: ({ stepNumber }) => trace.finishStep(stepNumber),
          onToolCallStart: (event) => trace.startTool(event),
          onToolCallFinish: (event) => trace.finishTool(event),
          onStreamPart: (part) => trace.handleStreamPart(part),
          onAbort: () => trace.finalize("aborted"),
          onError: (error) => trace.fail(error),
          onFinish: ({
            totalUsage,
            finishReason,
            providerMetadata,
            maxSteps,
            maxStepLimitReached,
            tokenAudit,
          }) => {
            trace.finalize(
              maxStepLimitReached ? "error" : "completed",
              totalUsage,
              providerMetadata,
              finishReason,
              { maxSteps, maxStepLimitReached, tokenAudit },
            );
            const delta = totalUsage.totalTokens;
            if (typeof delta === "number" && delta > 0) {
              addSessionTokens(sessionId, delta);
            }
          },
        });

        writer.merge(
          result.toUIMessageStream<AntonUIMessage>({
            sendReasoning: true,
            sendStart: false,
            sendFinish: false,
          }),
        );
      } catch (err) {
        trace.fail(err);
        throw err;
      }
    },
    onFinish: ({ messages }) => {
      const visibleMessages = messages
        .map(stripDurableTraceParts)
        .filter(hasSubstantiveHistoryParts);
      const persistedMessages =
        collapseAssistantContinuationMessages(visibleMessages);
      if (persistedMessages.length === 0) return;
      persistFinalToolApprovalStates(runId, messages);
      try {
        const approvalContinuation = isToolApprovalContinuation(persistedMessages);
        const collapsedContinuations =
          persistedMessages.length < visibleMessages.length;
        saveMessagesIncrementally<AntonUIMessage>(
          sessionId,
          redactValue(persistedMessages) as AntonUIMessage[],
          {
            pruneExtraAssistantTail:
              approvalContinuation || collapsedContinuations,
          },
        );
      } catch (err) {
        if (err instanceof MessagePersistenceConflictError) {
          updateRun(runId, {
            status: "error",
            finishReason: "message_persistence_conflict",
          });
          return;
        }
        throw err;
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}

function prepareMessagesForModel(
  messages: AntonUIMessage[],
  profile: AgentRunProfile,
): AntonUIMessage[] {
  const approvalContinuationMessageId = isToolApprovalContinuation(messages)
    ? messages.at(-1)?.id
    : undefined;
  const acceptedPlanMessageId = isAcceptedPlanProfile(profile)
    ? messages.findLast(isPlanAssistantMessage)?.id
    : undefined;

  return messages.flatMap((message) => {
    const source =
      message.id === acceptedPlanMessageId
        ? compactAcceptedPlanMessage(message, profile)
        : message;
    const parts = compactMessagePartsForModel(
      source,
      source.id === approvalContinuationMessageId,
    )
      .filter(isModelContextPart)
      .map(stripProviderReplayMetadata);
    if (!parts.some(isSubstantiveModelContextPart)) return [];
    return [{ ...source, parts }];
  });
}

function compactMessagePartsForModel(
  message: AntonUIMessage,
  approvalContinuation: boolean,
): AntonUIMessage["parts"] {
  if (message.role !== "assistant") return message.parts;
  if (approvalContinuation) {
    return message.parts.filter(isApprovalContinuationContextPart);
  }

  const lastToolIndex = message.parts.findLastIndex(isToolUIPart);
  const finalTextParts = message.parts.filter((part, index) => {
    return (
      part.type === "text" &&
      part.text.trim().length > 0 &&
      (lastToolIndex === -1 || index > lastToolIndex)
    );
  });
  if (finalTextParts.length > 0) return finalTextParts;

  return message.parts.filter((part) => {
    return part.type === "text" && part.text.trim().length > 0;
  });
}

function compactAcceptedPlanMessage(
  message: AntonUIMessage,
  profile: AgentRunProfile,
): AntonUIMessage {
  const planText = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  if (!planText.trim()) return message;

  return {
    ...message,
    parts: [
      {
        type: "text",
        text: acceptedPlanHandoff(planText, {
          maxChars: profile === "accepted-plan-simple" ? 3_000 : 6_000,
        }),
      },
    ],
  };
}

function acceptedPlanHandoff(
  planText: string,
  options: { maxChars: number },
): string {
  const normalized = planText.replace(/\r\n/g, "\n").trim();
  const targetFiles = extractPlanCodeSpans(normalized).filter(isLikelyRepoPath);
  const importantLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^#{1,4}\s/.test(line)) return true;
      if (/\b(pnpm|npm|yarn|bun)\s+(typecheck|lint|build|test)\b/.test(line)) {
        return true;
      }
      return extractPlanCodeSpans(line).some(isLikelyRepoPath);
    });

  const sections = [
    "Accepted plan compact handoff.",
    targetFiles.length > 0
      ? `Target files: ${Array.from(new Set(targetFiles)).slice(0, 20).join(", ")}`
      : "Target files: none detected in code spans.",
    importantLines.length > 0
      ? ["Relevant plan lines:", ...importantLines.slice(0, 40)].join("\n")
      : ["Plan excerpt:", normalized.slice(0, options.maxChars)].join("\n"),
  ];
  const handoff = sections.join("\n\n");
  if (handoff.length <= options.maxChars) return handoff;
  return `${handoff.slice(0, options.maxChars).trimEnd()}\n...[plan handoff truncated]`;
}

function extractPlanCodeSpans(text: string): string[] {
  return Array.from(text.matchAll(/`([^`]+)`/g), (match) => match[1].trim())
    .filter(Boolean);
}

function isLikelyRepoPath(value: string): boolean {
  return (
    /^(app|components|src|lib|public|docs|workspace)\//.test(value) ||
    /^(app|components|src|lib|public|docs|workspace)\\/.test(value) ||
    /^(AGENTS|CLAUDE|README|ROADMAP|package|tsconfig|next\.config|drizzle\.config)/.test(value)
  );
}

async function convertMessagesForRun(
  messages: AntonUIMessage[],
  runId: string,
  startedAt: number,
) {
  try {
    return await convertToModelMessages(messages, {
      convertDataPart: () => undefined,
    });
  } catch (err) {
    updateRun(runId, {
      status: "error",
      finishedAt: new Date(),
      durationMs: Math.max(0, Date.now() - startedAt),
      finishReason: "message_conversion_error",
    });
    throw err;
  }
}

function isModelContextPart(
  part: AntonUIMessage["parts"][number],
): boolean {
  if (part.type === "reasoning") return false;
  if (isUnfinishedToolPart(part)) return false;
  return !part.type.startsWith("data-");
}

function isSubstantiveModelContextPart(
  part: AntonUIMessage["parts"][number],
): boolean {
  return part.type !== "step-start";
}

function isUnfinishedToolPart(part: AntonUIMessage["parts"][number]): boolean {
  if (!("state" in part) || typeof part.state !== "string") return false;
  return (
    part.state === "input-streaming" ||
    part.state === "input-available"
  );
}

function hasSubstantiveHistoryParts(message: AntonUIMessage): boolean {
  return message.parts.some((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return part.text.trim().length > 0;
    }
    return part.type !== "step-start";
  });
}

function isApprovalContinuationContextPart(
  part: AntonUIMessage["parts"][number],
): boolean {
  if (!("state" in part) || typeof part.state !== "string") return false;
  return (
    part.state === "approval-responded" ||
    part.state === "output-denied"
  );
}

function isToolApprovalContinuation(messages: AntonUIMessage[]): boolean {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return false;
  return last.parts.some((part) => {
    if (!("state" in part) || typeof part.state !== "string") return false;
    return part.state === "approval-responded";
  });
}

function stripProviderReplayMetadata(
  part: AntonUIMessage["parts"][number],
): AntonUIMessage["parts"][number] {
  const clone = { ...part } as Record<string, unknown>;
  delete clone.providerMetadata;
  delete clone.callProviderMetadata;
  delete clone.resultProviderMetadata;
  return clone as AntonUIMessage["parts"][number];
}

function createTraceWriter({
  writer,
  runId,
  model,
  startedAt,
  workspaceRoot,
  responseKind,
}: {
  writer: UIMessageStreamWriter<AntonUIMessage>;
  runId: string;
  model: string;
  startedAt: number;
  workspaceRoot: string;
  responseKind?: "plan";
}) {
  let sequence = 0;
  let stepCount = 0;
  let finalized = false;
  let failedToolCount = 0;
  const events = new Map<string, AntonActivityEvent>();

  const metadata = (
    status: AntonRunStatus,
    extra: Partial<AntonMessageMetadata> = {},
  ): AntonMessageMetadata => ({
    runId,
    responseKind,
    model,
    status,
    startedAt,
    ...extra,
  });

  const writeMetadata = (
    status: AntonRunStatus,
    extra: Partial<AntonMessageMetadata> = {},
  ) => {
    writer.write({
      type: "message-metadata",
      messageMetadata: metadata(status, extra),
    });
  };

  const writeRun = (
    status: AntonRunStatus,
    extra: Partial<Omit<AntonRunData, "runId" | "model" | "status" | "startedAt">> = {},
  ) => {
    const data: AntonRunData = {
      runId,
      model,
      status,
      startedAt,
      ...extra,
    };
    writeMetadata(status, extra);
    writer.write({ type: "data-run", id: runId, data });
  };

  const persistEvent = (event: AntonActivityEvent) => {
    upsertRunEvent({
      id: event.id,
      runId: event.runId,
      sequence: event.sequence,
      kind: event.kind,
      status: event.status,
      label: event.label,
      summary: event.summary ? redactText(event.summary) : null,
      startedAt: new Date(event.startedAt),
      finishedAt: event.finishedAt ? new Date(event.finishedAt) : null,
      durationMs: event.durationMs ?? null,
      toolCallId: event.toolCallId ?? null,
      details: persistableEventDetails(event.details),
    });
  };

  const writeEvent = (event: AntonActivityEvent) => {
    const safeEvent = redactActivityEvent(event);
    events.set(safeEvent.id, safeEvent);
    persistEvent(safeEvent);
    writer.write({ type: "data-activity", id: safeEvent.id, data: safeEvent });
  };

  const writeTodos = (items: AntonTodoItem[]) => {
    const snapshot: AntonTodoSnapshot = {
      runId,
      items,
      updatedAt: Date.now(),
    };
    writer.write({ type: "data-todos", id: `${runId}:todos`, data: snapshot });
    startEvent({
      id: `${runId}:todos:${sequence + 1}`,
      kind: "progress",
      status: "completed",
      label: "Todos updated",
      summary: todoSummary(items),
      details: { todos: snapshot },
    });
  };

  const startEvent = ({
    id,
    kind,
    label,
    summary,
    status = "running",
    toolCallId,
    details,
  }: {
    id: string;
    kind: AntonActivityKind;
    label: string;
    summary?: string;
    status?: AntonActivityStatus;
    toolCallId?: string;
    details?: Record<string, unknown>;
  }) => {
    const event: AntonActivityEvent = {
      id,
      runId,
      sequence: ++sequence,
      kind,
      status,
      label,
      summary,
      startedAt: Date.now(),
      toolCallId,
      details,
    };
    writeEvent(event);
    return event;
  };

  const finishEvent = (
    id: string,
    patch: Partial<
      Pick<
        AntonActivityEvent,
        "status" | "label" | "summary" | "details" | "toolCallId"
      >
    > = {},
  ) => {
    const current = events.get(id);
    if (!current) return;
    const finishedAt = Date.now();
    writeEvent({
      ...current,
      ...patch,
      finishedAt,
      durationMs: Math.max(0, finishedAt - current.startedAt),
    });
  };

  const settleRunningEvents = (status: "completed" | "error") => {
    for (const event of Array.from(events.values())) {
      if (event.status !== "running") continue;
      finishEvent(event.id, { status });
    }
  };

  const summarizeInput = (input: unknown): string | undefined => {
    if (typeof input !== "object" || input === null) return undefined;
    const record = input as Record<string, unknown>;
    for (const key of ["command", "path", "sourcePath", "pattern", "slug", "task"]) {
      if (typeof record[key] === "string") return auditSummary(record[key]);
    }
    return undefined;
  };

  const summarizeOutput = (output: unknown, error: unknown): string | undefined => {
    const message = errorMessageOrUndefined(error);
    if (message) return auditSummary(message);
    if (typeof output !== "object" || output === null) return undefined;
    const record = output as Record<string, unknown>;
    for (const key of ["error", "failedReason", "path", "summary", "stdout"]) {
      if (typeof record[key] === "string") return auditSummary(record[key]);
    }
    if (typeof record.exitCode === "number") return `exit ${record.exitCode}`;
    return undefined;
  };

  const outputExitCode = (output: unknown): number | null => {
    if (typeof output !== "object" || output === null) return null;
    const exitCode = (output as Record<string, unknown>).exitCode;
    return typeof exitCode === "number" && Number.isInteger(exitCode)
      ? exitCode
      : null;
  };

  const toolError = (success: boolean, output: unknown, error: unknown): string | null => {
    const thrown = errorMessageOrUndefined(error);
    if (thrown) return auditSummary(thrown);
    if (!success) return "Tool execution failed";
    if (typeof output !== "object" || output === null) return null;
    const record = output as Record<string, unknown>;
    if (record.ok === false && typeof record.error === "string") {
      return auditSummary(record.error);
    }
    if (typeof record.failedReason === "string") {
      return auditSummary(record.failedReason);
    }
    if (typeof record.exitCode === "number" && record.exitCode !== 0) {
      return `exit ${record.exitCode}`;
    }
    return null;
  };

  const toolLabel = (name: string, input: unknown): string => {
    const summary = summarizeInput(input);
    if (name === "bash" && summary) return `Ran ${summary}`;
    if (name === "inspect_project") return "Inspected project";
    if (name === "verify") return "Ran verification";
    if (name === "read_file" && summary) return `Read ${summary}`;
    if (name === "read_dir" && summary) return `Listed ${summary}`;
    if (name === "stat" && summary) return `Inspected ${summary}`;
    if (name === "grep" && summary) return `Searched for ${summary}`;
    if (name === "glob" && summary) return `Listed ${summary}`;
    if (name === "write_file" && summary) return `Edited ${summary}`;
    if (name === "edit_file" && summary) return `Patched ${summary}`;
    if (name === "mkdir" && summary) return `Created directory ${summary}`;
    if (name === "delete" && summary) return `Deleted ${summary}`;
    if (name === "rename" && summary) return `Renamed ${summary}`;
    if (name === "copy" && summary) return `Copied ${summary}`;
    return name;
  };

  const finalize = (
    status: Exclude<AntonRunStatus, "running">,
    usage?: LanguageModelUsage,
    providerMetadata?: ProviderMetadata,
    finishReason?: FinishReason,
    limits: {
      maxSteps?: number;
      maxStepLimitReached?: boolean;
      tokenAudit?: TokenAudit;
    } = {},
  ) => {
    if (finalized) return;
    finalized = true;
    const effectiveStatus =
      status === "completed" && failedToolCount > 0 ? "error" : status;
    settleRunningEvents(effectiveStatus === "completed" ? "completed" : "error");
    const finishedAt = Date.now();
    const durationMs = Math.max(0, finishedAt - startedAt);
    const inputTokens = usage?.inputTokens;
    const outputTokens = usage?.outputTokens;
    const totalTokens = usage?.totalTokens;
    const costUsd = openRouterCost(providerMetadata);
    const costMetadata = runCostMetadata(providerMetadata, limits.tokenAudit);
    const storedFinishReason = limits.maxStepLimitReached
      ? "max_step_limit"
      : effectiveStatus === "error" && failedToolCount > 0
        ? "tool_error"
      : finishReason;
    writeRun(effectiveStatus, {
      finishedAt,
      durationMs,
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      stepCount,
      finishReason: storedFinishReason,
      maxSteps: limits.maxSteps,
      maxStepLimitReached: limits.maxStepLimitReached,
    });
    if (limits.maxStepLimitReached) {
      startEvent({
        id: `${runId}:limit:${sequence + 1}`,
        kind: "error",
        status: "error",
        label: "Max step limit reached",
        summary: `Stopped after ${limits.maxSteps ?? stepCount} steps before the agent produced a final answer.`,
        details: {
          finishReason,
          stepCount,
          maxSteps: limits.maxSteps,
        },
      });
    }
    updateRun(runId, {
      status: effectiveStatus,
      finishedAt: new Date(finishedAt),
      durationMs,
      inputTokens: inputTokens ?? null,
      outputTokens: outputTokens ?? null,
      totalTokens: totalTokens ?? null,
      costUsd: costUsd ?? null,
      costMetadata,
      stepCount,
      finishReason: storedFinishReason ?? null,
    });
  };

  return {
    writeRun,
    startStep(stepNumber: number) {
      stepCount = Math.max(stepCount, stepNumber + 1);
      startEvent({
        id: `${runId}:step:${stepNumber}`,
        kind: "step",
        label: `Step ${stepNumber + 1}`,
      });
    },
    finishStep(stepNumber: number) {
      finishEvent(`${runId}:step:${stepNumber}`, {
        status: "completed",
        label: `Step ${stepNumber + 1} completed`,
      });
    },
    startTool(event: {
      stepNumber: number | undefined;
      toolCallId: string;
      toolName: string;
      input: unknown;
    }) {
      const details: Record<string, unknown> = {
        toolName: event.toolName,
        stepNumber: event.stepNumber,
      };
      if (event.toolName === "bash") {
        details.streamToken = bashProgress.prepareStream(event.toolCallId);
      }

      const permissionMeta = getNativeToolPermissionMetadata(event.toolName);
      if (permissionMeta) {
        details.riskCategories = [...permissionMeta.categories];
        details.riskSummary = permissionMeta.summary;
      } else if (isMcpTool(event.toolName)) {
        const parts = event.toolName.split("__");
        details.riskCategories = ["external-integration"];
        details.riskSummary = `Calls external MCP tool "${parts[2] ?? event.toolName}" from "${parts[1] ?? "unknown"}" server.`;
      }

      const approval = buildToolApprovalMetadata({
        toolName: event.toolName,
        input: event.input,
        workspaceRoot,
      });
      if (approval) {
        details.approval = redactValue(approval);
        details.riskCategories = [...approval.riskCategories];
        details.riskSummary = approval.summary;
      }

      if (event.toolName === "bash") {
        const classification = preClassifyBashInput(event.input);
        if (classification) {
          details.bashClassification = {
            categories: [...classification.categories],
            forbidden: classification.forbidden,
            reason: classification.reason,
          };
        }
      }

      const started = startEvent({
        id: `${runId}:tool:${event.toolCallId}`,
        kind: "tool",
        label: toolLabel(event.toolName, event.input),
        summary: summarizeInput(event.input),
        toolCallId: event.toolCallId,
        details,
      });
      const approvalDetails = structuredApprovalDetails(details.approval);
      upsertToolCall({
        id: started.id,
        runId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        stepNumber: event.stepNumber ?? null,
        status: "running",
        inputSummary: started.summary ?? null,
        approvalDecision: approvalDetails ? "pending" : null,
        startedAt: new Date(started.startedAt),
      });
      if (approvalDetails) {
        upsertToolApproval({
          id: `${started.id}:approval`,
          toolCallId: started.id,
          approvalId: null,
          decision: "pending",
          title: approvalDetails.title,
          summary: approvalDetails.summary,
          riskCategories: approvalDetails.riskCategories,
          metadata: approvalDetails,
          requestedAt: new Date(started.startedAt),
        });
      }
    },
    finishTool(event: {
      stepNumber: number | undefined;
      toolCallId: string;
      toolName: string;
      input: unknown;
      success: boolean;
      durationMs: number;
      output?: unknown;
      error?: unknown;
    }) {
      const current = events.get(`${runId}:tool:${event.toolCallId}`);
      const error = toolError(event.success, event.output, event.error);
      const status = error ? "error" : "completed";
      if (error) failedToolCount += 1;
      finishEvent(`${runId}:tool:${event.toolCallId}`, {
        status,
        label: toolLabel(event.toolName, event.input),
        summary: summarizeInput(event.input),
        details: {
          ...current?.details,
          toolName: event.toolName,
          stepNumber: event.stepNumber,
          success: event.success,
          error,
        },
      });
      const currentApproval = structuredApprovalDetails(current?.details?.approval);
      const toolCallUpdate: Parameters<typeof updateToolCall>[1] = {
        status,
        outputSummary: summarizeOutput(event.output, event.error) ?? null,
        exitCode: outputExitCode(event.output),
        error,
        finishedAt: new Date(),
        durationMs: event.durationMs,
      };
      if (currentApproval) toolCallUpdate.approvalDecision = "approved";
      updateToolCall(`${runId}:tool:${event.toolCallId}`, toolCallUpdate);
      if (currentApproval) {
        upsertToolApproval({
          id: `${runId}:tool:${event.toolCallId}:approval`,
          toolCallId: `${runId}:tool:${event.toolCallId}`,
          approvalId: null,
          decision: "approved",
          title: currentApproval.title,
          summary: currentApproval.summary,
          riskCategories: currentApproval.riskCategories,
          metadata: currentApproval,
          requestedAt: current
            ? new Date(current.startedAt)
            : new Date(Date.now() - event.durationMs),
          respondedAt: new Date(),
        });
      }
      const todos =
        todoItemsFromToolOutput(event.toolName, event.output) ??
        todoItemsFromToolInput(event.toolName, event.input);
      if (todos) writeTodos(todos);
    },
    handleStreamPart(part: TextStreamPart<ToolSet>) {
      if (part.type === "reasoning-start") {
        startEvent({
          id: `${runId}:reasoning:${part.id}`,
          kind: "reasoning",
          label: "Thinking",
        });
      }
      if (part.type === "reasoning-end") {
        finishEvent(`${runId}:reasoning:${part.id}`, {
          status: "completed",
          label: "Thought",
        });
      }
      if (part.type === "error") {
        startEvent({
          id: `${runId}:error:${sequence + 1}`,
          kind: "error",
          status: "error",
          label: "Stream error",
          summary: redactText(errorMessage(part.error)),
        });
      }
    },
    fail(error: unknown) {
      startEvent({
        id: `${runId}:error:${sequence + 1}`,
        kind: "error",
        status: "error",
        label: "Run failed",
        summary: redactText(errorMessage(error)),
      });
      finalize("error");
    },
    finalize,
  };
}

function todoItemsFromToolOutput(
  toolName: string,
  output: unknown,
): AntonTodoItem[] | undefined {
  if (toolName !== "update_todos") return undefined;
  if (!isRecord(output) || output.ok !== true || !Array.isArray(output.items)) {
    return undefined;
  }

  const items = output.items.flatMap((item): AntonTodoItem[] => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === "string" ? item.id : "";
    const text = typeof item.text === "string" ? item.text : "";
    const status = item.status;
    if (
      !id ||
      !text ||
      (status !== "pending" &&
        status !== "in_progress" &&
        status !== "completed")
    ) {
      return [];
    }
    return [{ id, text, status }];
  });

  return items.length > 0 ? items : undefined;
}

function todoItemsFromToolInput(
  toolName: string,
  input: unknown,
): AntonTodoItem[] | undefined {
  if (toolName !== "update_todos" || !isRecord(input) || !Array.isArray(input.items)) {
    return undefined;
  }

  const items = input.items.flatMap((item): AntonTodoItem[] => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const text =
      typeof item.text === "string"
        ? item.text.replace(/\s+/g, " ").trim()
        : "";
    const status = item.status;
    if (
      !id ||
      !text ||
      (status !== "pending" &&
        status !== "in_progress" &&
        status !== "completed")
    ) {
      return [];
    }
    return [{ id, text, status }];
  });

  return items.length > 0 ? items : undefined;
}

function todoSummary(items: AntonTodoItem[]): string {
  const completed = items.filter((item) => item.status === "completed").length;
  const inProgress = items.find((item) => item.status === "in_progress");
  return inProgress
    ? `${completed}/${items.length} complete; current: ${inProgress.text}`
    : `${completed}/${items.length} complete`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function stripDurableTraceParts(message: AntonUIMessage): AntonUIMessage {
  const runPart = message.parts.find(isRunDataPart);
  const metadata =
    runPart && !message.metadata?.runId
      ? { ...message.metadata, runId: runPart.data.runId }
      : message.metadata;

  return {
    ...message,
    metadata,
    parts: message.parts.filter(
      (part) => part.type !== "data-run" && part.type !== "data-activity",
    ),
  };
}

function errorMessageOrUndefined(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  return errorMessage(error);
}

function openRouterCost(providerMetadata: ProviderMetadata | undefined): number | undefined {
  const openrouter = providerMetadata?.openrouter;
  if (!isRecord(openrouter)) return undefined;
  const usage = openrouter.usage;
  if (!isRecord(usage)) return undefined;
  const cost = usage.cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : undefined;
}

function openRouterCostMetadata(
  providerMetadata: ProviderMetadata | undefined,
): Record<string, unknown> | null {
  const openrouter = providerMetadata?.openrouter;
  if (!isRecord(openrouter)) return null;
  const usage = openrouter.usage;
  if (!isRecord(usage)) return null;
  return redactValue({
    provider: "openrouter",
    source: "providerMetadata.openrouter.usage",
    usage,
  }) as Record<string, unknown>;
}

function runCostMetadata(
  providerMetadata: ProviderMetadata | undefined,
  tokenAudit: TokenAudit | undefined,
): Record<string, unknown> | null {
  const providerCostMetadata = openRouterCostMetadata(providerMetadata);
  if (!tokenAudit) return providerCostMetadata;
  return redactValue({
    ...(providerCostMetadata ?? {}),
    tokenAudit,
  }) as Record<string, unknown>;
}

function runProfileForMessages(
  mode: "chat" | "plan",
  messages: AntonUIMessage[],
): AgentRunProfile {
  if (mode === "plan") return "plan";
  if (isToolApprovalContinuation(messages)) return "approval-continuation";
  const latestText = latestUserText(messages).trim().toLowerCase();
  if (latestText === "implement plan") return "accepted-plan-simple";
  if (
    latestText === "implement the plan" ||
    latestText === "apply plan" ||
    latestText === "apply the plan"
  ) {
    return "accepted-plan-general";
  }
  if (isCommandRunRequest(latestText)) return "command-run";
  return "general-chat";
}

function isCommandRunRequest(text: string): boolean {
  if (/\b(fix|change|update|modify|implement|edit|write|delete|rename)\b/.test(text)) {
    return false;
  }
  return (
    /\b(run|execute|check|verify)\b/.test(text) &&
    /\b(build|typecheck|type-check|lint|test|pnpm|npm|yarn|bun|next build|tsc|eslint)\b/.test(text)
  );
}

function isAcceptedPlanProfile(profile: AgentRunProfile): boolean {
  return profile === "accepted-plan-simple" || profile === "accepted-plan-general";
}

function isPlanAssistantMessage(message: AntonUIMessage): boolean {
  return message.role === "assistant" && message.metadata?.responseKind === "plan";
}

function latestUserText(messages: AntonUIMessage[]): string {
  const latest = messages.findLast((message) => message.role === "user");
  if (!latest) return "";
  return latest.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structuredApprovalDetails(value: unknown):
  | {
      title: string;
      summary: string;
      riskCategories: string[];
      [key: string]: unknown;
    }
  | undefined {
  if (!isRecord(value)) return undefined;
  const title = value.title;
  const summary = value.summary;
  const riskCategories = value.riskCategories;
  if (
    typeof title !== "string" ||
    typeof summary !== "string" ||
    !Array.isArray(riskCategories)
  ) {
    return undefined;
  }
  return {
    ...value,
    title,
    summary,
    riskCategories: riskCategories.filter(
      (category): category is string => typeof category === "string",
    ),
  };
}

function persistFinalToolApprovalStates(
  runId: string,
  messages: AntonUIMessage[],
): void {
  const entries = getToolTraceEntries(messages);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      if (!("toolCallId" in part) || typeof part.toolCallId !== "string") {
        continue;
      }
      if (!("approval" in part) || !isRecord(part.approval)) continue;

      const approvalId =
        typeof part.approval.id === "string" ? part.approval.id : null;
      const approved =
        typeof part.approval.approved === "boolean"
          ? part.approval.approved
          : undefined;
      const reason =
        typeof part.approval.reason === "string"
          ? auditSummary(part.approval.reason)
          : null;
      const decision =
        part.state === "output-denied" || approved === false
          ? "denied"
          : approved === true || part.state === "output-available" || part.state === "output-error"
            ? "approved"
            : "pending";
      const toolCallRowId = `${runId}:tool:${part.toolCallId}`;
      const entry = entriesById.get(part.toolCallId);
      const approval = entry ? getApprovalMetadata(entry) : undefined;
      const now = new Date();
      const existingToolCall = getToolCall(toolCallRowId);
      if (existingToolCall) {
        updateToolCall(toolCallRowId, {
          approvalDecision: decision,
          ...(decision === "denied"
            ? {
                status: "denied",
                finishedAt: now,
                durationMs: Math.max(
                  0,
                  now.getTime() - existingToolCall.startedAt.getTime(),
                ),
              }
            : {}),
        });
      } else {
        upsertToolCall({
          id: toolCallRowId,
          runId,
          toolCallId: part.toolCallId,
          toolName: getToolName(part),
          status: decision === "denied" ? "denied" : "running",
          inputSummary:
            entry?.activity?.summary ??
            ("input" in part ? summarizeToolInputForPersistence(part.input) : null),
          approvalDecision: decision,
          startedAt: now,
          finishedAt: decision === "denied" ? now : null,
        });
      }

      upsertToolApproval({
        id: `${toolCallRowId}:approval`,
        toolCallId: toolCallRowId,
        approvalId,
        decision,
        title: approval?.title ?? getToolName(part),
        summary: approval?.summary ?? "Tool approval requested.",
        riskCategories: approval?.riskCategories ?? [],
        metadata: approval ?? null,
        requestedAt: now,
        respondedAt: decision === "pending" ? null : now,
        reason,
      });
    }
  }
}

function summarizeToolInputForPersistence(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  for (const key of ["command", "path", "sourcePath", "pattern", "slug", "task"]) {
    if (typeof record[key] === "string") return auditSummary(record[key]);
  }
  return null;
}

function auditSummary(value: string, maxLength = 500): string {
  const redacted = redactText(value).replace(/\s+/g, " ").trim();
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, maxLength - 3).trimEnd()}...`;
}

function persistableEventDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!details) return null;
  const persistable = { ...details };
  delete persistable.streamToken;
  return redactValue(persistable) as Record<string, unknown>;
}

function redactActivityEvent(event: AntonActivityEvent): AntonActivityEvent {
  const details = event.details
    ? (redactValue(event.details) as Record<string, unknown>)
    : undefined;
  if (details && event.details && "streamToken" in event.details) {
    details.streamToken = event.details.streamToken;
  }
  return {
    ...event,
    label: redactText(event.label),
    summary: event.summary ? redactText(event.summary) : event.summary,
    details,
  };
}
