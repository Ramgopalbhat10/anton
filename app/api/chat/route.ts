import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  getToolName,
  isToolUIPart,
  type FinishReason,
  type LanguageModelUsage,
  type ModelMessage,
  type ProviderMetadata,
  type TextStreamPart,
  type ToolSet,
  type UIMessageStreamWriter,
} from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  runAgent,
  type AgentRunMode,
  type AgentRunProfile,
  type TokenAudit,
} from "@/src/agent/loop";
import {
  classifyRunProfile,
  isBroadScopeRequest,
  isImplementationRequest,
  executionModelFromCostMetadata,
  executionProfileFromCostMetadata,
  runIdFromAssistantMessage,
} from "@/src/agent/profile-classifier";
import {
  resolveSingleFileTarget,
  singleFileTargetContext,
  type SingleFileTargetResolution,
} from "@/src/agent/single-file-target";
import {
  budgetMessagesForModel,
  type ContextBudgetReport,
} from "@/src/agent/context-budget";
import {
  priorToolRecordsFromAssistantMessage,
} from "@/src/agent/tool-policy";
import {
  promptCacheAuditFromCostMetadata,
} from "@/src/agent/prompt-cache-audit";
import {
  buildSessionContextDigest,
  RunContextCollector,
  type RunContextStatus,
} from "@/src/agent/context";
import { buildWorkspaceContextDigest } from "@/src/agent/workspace-context";
import { budgetForProfile } from "@/src/agent/run-budget";
import { compactReadFileForModel } from "@/src/agent/tools/model-output";
import type { ProfilePromotionEvent } from "@/src/agent/profile-promotion";
import {
  buildToolApprovalMetadata,
  commandPolicyModeForPermission,
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
  getRunById,
  getSession,
  getWorkspaceSettings,
  getToolCall,
  listRunsForSession,
  MessagePersistenceConflictError,
  saveMessagesIncrementally,
  sessionHasStoredMessages,
  setSessionProject,
  touchSession,
  updateRun,
  updateToolCall,
  upsertToolApproval,
  upsertToolCall,
  upsertRunEvent,
} from "@/src/db/queries";
import { registerActiveChatStream } from "@/src/lib/chat-stream-registry";
import { DEFAULT_MODEL } from "@/src/lib/providers";
import { getProviderId, resolveModelId } from "@/src/lib/models";
import { isSupportedAgentModelId } from "@/src/lib/openrouter-catalog";
import {
  resolveOpenRouterRouting,
  type OpenRouterRoutingResolution,
} from "@/src/lib/openrouter-routing";
import { CHAT_MODES, DEFAULT_CHAT_MODE, type ChatMode } from "@/src/lib/chat-modes";
import { parseAntonUIMessages } from "@/src/lib/anton-message-validation";
import { redactText, redactValue } from "@/src/lib/redaction";
import {
  outputExitCode as sharedOutputExitCode,
  summarizeToolInput,
  summarizeToolOutput,
} from "@/src/lib/tool-summaries";
import {
  buildTokenUsageMetrics,
  openRouterCostFromMetadata,
  type TokenUsageMetrics,
} from "@/src/lib/token-usage";
import {
  collapseAssistantContinuationMessages,
  getApprovalMetadata,
  getAssistantTextDisplay,
  getToolTraceEntries,
  isRunDataPart,
  priorSegmentUsage,
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
  mode: z.enum(CHAT_MODES).optional(),
  thinkingEnabled: z.boolean().optional(),
  continueProfileHandoff: z
    .object({
      runId: z.string().min(1),
    })
    .optional(),
  messages: z.unknown(),
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

  const messages = parseAntonUIMessages(parsed.data.messages);
  if (!messages.ok) {
    return Response.json(
      { error: "invalid messages", issues: messages.issues },
      { status: 400 },
    );
  }

  const { sessionId } = parsed.data;
  const uiMessages = messages.messages;
  const incomingHistory = uiMessages.filter(hasSubstantiveHistoryParts);
  const profileHandoffContinuation = parsed.data.continueProfileHandoff;
  const isProfileHandoffContinuation =
    profileHandoffContinuation !== undefined;
  const approvalContinuation =
    !isProfileHandoffContinuation && isToolApprovalContinuation(incomingHistory);
  const mode = approvalContinuation || isProfileHandoffContinuation
    ? "agent"
    : parsed.data.mode ?? DEFAULT_CHAT_MODE;
  const profileHandoffRun =
    isProfileHandoffContinuation && profileHandoffContinuation
      ? getRunById(profileHandoffContinuation.runId)
      : undefined;
  let profile = resolveRunProfile({
    mode,
    messages: incomingHistory,
    approvalContinuation,
    profileHandoffRun,
  });
  const needsProject = mode !== "chat";
  const requestBodyBytes = byteLength(JSON.stringify(json ?? {}));
  const workspaceSettings = getWorkspaceSettings();
  const requestedModel =
    parsed.data.model ??
    workspaceSettings.defaultModel ??
    DEFAULT_MODEL;
  const approvalContinuationRunId = approvalContinuation
    ? runIdFromAssistantMessage(incomingHistory.at(-1))
    : undefined;
  const approvalContinuationRun = approvalContinuationRunId
    ? getRunById(approvalContinuationRunId)
    : undefined;
  const continuationModel =
    executionModelFromCostMetadata(profileHandoffRun?.costMetadata) ??
    executionModelFromCostMetadata(approvalContinuationRun?.costMetadata);
  const model = resolveModelId(continuationModel ?? requestedModel);
  const modelSelectionNote =
    continuationModel && continuationModel !== requestedModel
      ? `UI selected ${requestedModel}, but this continuation reused ${continuationModel} from the originating run.`
      : undefined;
  if (!(await isSupportedAgentModelId(continuationModel ?? requestedModel))) {
    return Response.json(
      { error: "unsupported model", model },
      { status: 400 },
    );
  }
  const openRouterRouting = resolveOpenRouterRouting(
    model,
    workspaceSettings.openRouterRoutingPreferences,
  );

  const existing = getSession(sessionId);
  const requestedProjectId = parsed.data.projectId ?? null;

  if (isProfileHandoffContinuation) {
    if (
      !profileHandoffRun ||
      profileHandoffRun.sessionId !== sessionId ||
      !runEligibleForProfileHandoffContinuation(profileHandoffRun)
    ) {
      return Response.json(
        { error: "profile handoff continuation requires a completed handoff run in this session" },
        { status: 400 },
      );
    }
    const existingContinuation = listRunsForSession(sessionId).find(
      (run) =>
        run.id !== profileHandoffRun.id &&
        profileHandoffContinuationOfRunId(run.costMetadata) ===
          profileHandoffRun.id,
    );
    if (existingContinuation) {
      return Response.json(
        {
          error: "profile handoff continuation already started",
          runId: existingContinuation.id,
        },
        { status: 409 },
      );
    }
  }

  if (existing) {
    if (
      existing.projectId &&
      requestedProjectId &&
      existing.projectId !== requestedProjectId
    ) {
      return Response.json(
        { error: "session project cannot be changed" },
        { status: 400 },
      );
    }
    if (
      !existing.projectId &&
      requestedProjectId &&
      sessionHasStoredMessages(sessionId)
    ) {
      return Response.json(
        { error: "project cannot be attached after the session has started" },
        { status: 400 },
      );
    }
  }

  const projectId = existing?.projectId ?? requestedProjectId ?? null;
  if (needsProject && !projectId) {
    return Response.json(
      { error: "projectId is required for project-aware modes" },
      { status: 400 },
    );
  }

  const project = projectId ? getProject(projectId) : undefined;
  if (needsProject && (!project || project.status !== "ready")) {
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
    const conflict = getMessagePersistenceConflict(sessionId, incomingHistory, {
      mutableTailCount:
        approvalContinuation || isProfileHandoffContinuation
          ? 1
          : 0,
      allowExtraAssistantTail:
        approvalContinuation || isProfileHandoffContinuation,
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
  if (incomingHistory.length > 0) {
    saveMessagesIncrementally<AntonUIMessage>(
      sessionId,
      redactValue(incomingHistory) as AntonUIMessage[],
    );
  }

  const permissionMode =
    (isProfileHandoffContinuation && profileHandoffRun
      ? permissionModeFromCostMetadata(profileHandoffRun.costMetadata)
      : undefined) ??
    parsed.data.permissionMode ??
    workspaceSettings.defaultPermissionMode ??
    "auto-review";
  const thinkingEnabled =
    (isProfileHandoffContinuation && profileHandoffRun
      ? thinkingEnabledFromCostMetadata(profileHandoffRun.costMetadata)
      : undefined) ??
    parsed.data.thinkingEnabled ??
    false;

  const isSegmentContinuation = isProfileHandoffContinuation;
  const userText = latestUserText(uiMessages);
  const inheritedSingleFileTargetResolution =
    profile === "single-file-edit"
      ? singleFileTargetResolutionFromCostMetadata(
          approvalContinuationRun?.costMetadata,
        )
      : undefined;
  const singleFileTargetResolution =
    inheritedSingleFileTargetResolution ??
    (shouldAttemptSingleFileEditRouting({
        mode,
        profile,
        latestUserText: userText,
        isSegmentContinuation,
        approvalContinuation,
      })
        ? resolveSingleFileTarget(userText, project?.localPath)
        : undefined);
  if (
    singleFileTargetResolution?.targetResolution === "exact" ||
    singleFileTargetResolution?.targetResolution === "unique_search"
  ) {
    profile = "single-file-edit";
  } else if (singleFileTargetResolution) {
    profile = "general-chat";
  }

  const budget = budgetForProfile(profile);
  const continuationAssistant = isProfileHandoffContinuation
    ? incomingHistory.findLast((message) => message.role === "assistant")
    : undefined;
  const priorUsage = continuationAssistant
    ? priorSegmentUsage(continuationAssistant)
    : { tokensUsed: 0, effectiveTokensUsed: 0, costUsd: 0 };
  const priorToolHistory = continuationAssistant
    ? priorToolRecordsFromAssistantMessage(continuationAssistant)
    : [];
  const previousPromptCacheAudit = promptCacheAuditFromCostMetadata(
    profileHandoffRun?.costMetadata ?? approvalContinuationRun?.costMetadata,
  );
  const continuationNote = isProfileHandoffContinuation && profileHandoffRun
      ? profileHandoffContinuationNote(profileHandoffRun.costMetadata)
      : undefined;
  const promptCacheIntentionalSegmentTransition =
    isProfileHandoffContinuation && profileHandoffRun
      ? profileHandoffTransitionLabel(profileHandoffRun.costMetadata)
      : undefined;
  const sessionContextDigest =
    mode === "chat" || isSegmentContinuation || profile === "single-file-edit"
      ? undefined
      : buildSessionContextDigest({
          sessionId,
          latestUserText: userText,
          budgetChars: budget.priorRunContextChars,
        });
  const workspaceContextDigest =
    mode === "chat" || isSegmentContinuation || profile === "single-file-edit"
      ? undefined
      : buildWorkspaceContextDigest({
          workspaceRoot: project?.localPath,
          latestUserText: userText,
          budgetChars: budget.workspaceContextChars,
        });
  const contextDigestBytes = byteLength(
    isProfileHandoffContinuation
      ? (continuationNote ?? "")
      : profile === "single-file-edit" &&
          singleFileTargetResolution &&
          "targetPath" in singleFileTargetResolution
        ? singleFileTargetContext(singleFileTargetResolution)
      : (modelOnlyContextMessageText({
          sessionContextDigest,
          workspaceContextDigest,
        }) ?? ""),
  );
  const preservation = modelContextPreservation(
    uiMessages,
    profile,
    isSegmentContinuation,
  );
  const preparedMessages = prepareMessagesForModel(
    uiMessages,
    profile,
    isSegmentContinuation,
  );
  const contextBudget = budgetMessagesForModel({
    messages: preparedMessages,
    budget,
    ...preservation,
    contextDigestBytes,
  });
  if (!contextBudget.ok) {
    return Response.json(
      {
        error: contextBudget.error,
        contextBudget: contextBudget.report,
      },
      { status: contextBudget.status },
    );
  }

  const runId = randomUUID();
  const startedAt = Date.now();
  createRun({
    id: runId,
    sessionId,
    model,
    provider: getProviderId(model),
    status: "running",
    startedAt: new Date(startedAt),
    stepCount: 0,
    costMetadata: {
      execution: {
        profile,
        mode,
        model,
        permissionMode,
        thinkingEnabled,
        ...(openRouterRouting ? { openRouterRouting } : {}),
        ...(profileHandoffRun
          ? {
              profileHandoffContinuationOfRunId: profileHandoffRun.id,
            }
          : {}),
        ...(singleFileTargetMetadata(singleFileTargetResolution) ?? {}),
      },
    },
  });

  const convertedMessages = await convertMessagesForRun(
    contextBudget.messages,
    runId,
    startedAt,
  );
  const modelMessages = isProfileHandoffContinuation
    ? appendModelOnlyContextMessage(convertedMessages, continuationNote ?? "")
    : profile === "single-file-edit" &&
        singleFileTargetResolution &&
        "targetPath" in singleFileTargetResolution
      ? addSingleFileTargetContextMessage(
          convertedMessages,
          singleFileTargetContext(singleFileTargetResolution),
        )
    : addModelOnlyContextMessage(convertedMessages, {
        sessionContextDigest,
        workspaceContextDigest,
      });
  const contextCollector = new RunContextCollector(runId, sessionId);
  let contextTerminalStatus: RunContextStatus = "completed";
  let contextTerminalError: unknown;

  const stream = createUIMessageStream<AntonUIMessage>({
    originalMessages: uiMessages,
    execute: async ({ writer }) => {
      const trace = createTraceWriter({
        writer,
        runId,
        model,
        profile,
        mode,
        startedAt,
        workspaceRoot: project?.localPath,
        responseKind: mode === "plan" ? "plan" : undefined,
        permissionMode,
        thinkingEnabled,
        openRouterRouting,
        profileHandoffContinuationOfRunId: profileHandoffRun?.id,
      });
      trace.writeRun("running");
      trace.noteContextBudget(contextBudget.report);
      if (modelSelectionNote) {
        trace.noteModelSelection(modelSelectionNote);
      }
      trace.noteTargetResolution(singleFileTargetResolution);

      try {
        const result = await runAgent({
          messages: modelMessages,
          model,
          workspaceRoot: project?.localPath,
          mode,
          profile,
          requestBodyBytes,
          contextBudget: contextBudget.report,
          thinkingEnabled,
          priorTokensUsed: priorUsage.tokensUsed,
          priorCostUsd: priorUsage.costUsd,
          priorToolHistory,
          previousPromptCacheAudit,
          promptCacheIntentionalSegmentTransition,
          singleFileTargetPath:
            singleFileTargetResolution && "targetPath" in singleFileTargetResolution
              ? singleFileTargetResolution.targetPath
              : undefined,
          singleFileTargetResolution:
            singleFileTargetResolution?.targetResolution,
          singleFileTargetResolutionReason:
            singleFileTargetResolution?.targetResolutionReason,
          permissionMode,
          enabledMcpServerIds: parsed.data.enabledMcpServerIds,
          openRouterRouting,
          onStepStart: ({ stepNumber }) => trace.startStep(stepNumber),
          onStepFinish: ({ stepNumber }) => trace.finishStep(stepNumber),
          onStepUsageUpdate: (steps) => trace.updateStepUsage(steps),
          onToolCallStart: (event) => trace.startTool(event),
          onToolCallFinish: (event) => {
            contextCollector.addTool(event);
            trace.finishTool(event);
          },
          onLoopGuard: (event) => {
            contextCollector.addLoopGuard(event);
            trace.noteLoopGuard(event);
          },
          onMcpWarnings: (warnings) => trace.noteMcpWarnings(warnings),
          onProfilePromotion: (event) => trace.noteProfilePromotion(event),
          onStreamPart: (part) => trace.handleStreamPart(part),
          onAbort: () => {
            contextTerminalStatus = "aborted";
            trace.finalize("aborted");
            contextCollector.persist({ status: "aborted" });
          },
          onError: (error) => {
            contextTerminalStatus = "error";
            contextTerminalError = error;
            trace.fail(error);
            contextCollector.persist({ status: "error", error });
          },
          onFinish: ({
            totalUsage,
            finishReason,
            providerMetadata,
            stepProviderMetadata,
            loopGuardIncomplete,
            unverifiedEdit,
            verificationFailed,
            profileHandoffRequired,
            profileHandoff,
            tokenAudit,
          }) => {
            const incompleteRun =
              !profileHandoffRequired &&
              (loopGuardIncomplete === true ||
                unverifiedEdit === true ||
                verificationFailed === true);
            contextTerminalStatus = incompleteRun ? "error" : "completed";
            trace.finalize(
              incompleteRun ? "error" : "completed",
              totalUsage,
              providerMetadata,
              finishReason,
              {
                loopGuardIncomplete: incompleteRun,
                unverifiedEdit,
                verificationFailed,
                profileHandoffRequired,
                profileHandoff,
                tokenAudit,
                stepProviderMetadata,
              },
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
        contextTerminalStatus = "error";
        contextTerminalError = err;
        trace.fail(err);
        contextCollector.persist({ status: "error", error: err });
        writeStreamErrorText(writer, runId, err);
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
        const approvalContinuation =
          isToolApprovalContinuation(persistedMessages);
        const profileHandoffContinuationPersisted = isProfileHandoffContinuation;
        const collapsedContinuations =
          persistedMessages.length < visibleMessages.length;
        saveMessagesIncrementally<AntonUIMessage>(
          sessionId,
          redactValue(persistedMessages) as AntonUIMessage[],
          {
            pruneExtraAssistantTail:
              approvalContinuation ||
              profileHandoffContinuationPersisted ||
              collapsedContinuations,
          },
        );
        contextCollector.persist({
          status: contextTerminalStatus,
          finalText: finalAssistantText(messages),
          error: contextTerminalError,
        });
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

  return createUIMessageStreamResponse({
    stream: registerActiveChatStream(sessionId, stream),
  });
}

function finalAssistantText(messages: AntonUIMessage[]): string | undefined {
  const assistant = messages.findLast((message) => message.role === "assistant");
  if (!assistant) return undefined;
  const display = getAssistantTextDisplay(assistant);
  const finalText = display.finalText || display.progressText;
  return finalText.trim() || undefined;
}

function writeStreamErrorText(
  writer: UIMessageStreamWriter<AntonUIMessage>,
  runId: string,
  error: unknown,
): void {
  const id = `${runId}:stream-error-text`;
  const message = `Run failed: ${redactText(errorMessage(error))}`;
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: message });
  writer.write({ type: "text-end", id });
}

function prepareMessagesForModel(
  messages: AntonUIMessage[],
  profile: AgentRunProfile,
  segmentContinuation: boolean,
  preservation = modelContextPreservation(messages, profile, segmentContinuation),
): AntonUIMessage[] {
  return messages.flatMap((message) => {
    const source =
      message.id === preservation.acceptedPlanMessageId
        ? compactAcceptedPlanMessage(message, profile)
        : message;
    const parts = compactMessagePartsForModel(
      source,
      source.id === preservation.approvalContinuationMessageId,
      source.id === preservation.segmentContinuationMessageId,
    )
      .filter(isModelContextPart)
      .map(stripProviderReplayMetadata);
    if (!parts.some(isSubstantiveModelContextPart)) return [];
    return [{ ...source, parts }];
  });
}

function modelContextPreservation(
  messages: AntonUIMessage[],
  profile: AgentRunProfile,
  segmentContinuation = false,
): {
  approvalContinuationMessageId?: string;
  acceptedPlanMessageId?: string;
  segmentContinuationMessageId?: string;
} {
  return {
    ...(isToolApprovalContinuation(messages)
      ? { approvalContinuationMessageId: messages.at(-1)?.id }
      : {}),
    ...(segmentContinuation
      ? { segmentContinuationMessageId: messages.at(-1)?.id }
      : {}),
    ...(isAcceptedPlanProfile(profile)
      ? { acceptedPlanMessageId: messages.findLast(isPlanAssistantMessage)?.id }
      : {}),
  };
}

function compactMessagePartsForModel(
  message: AntonUIMessage,
  approvalContinuation: boolean,
  segmentContinuation: boolean,
): AntonUIMessage["parts"] {
  if (message.role !== "assistant") return message.parts;
  if (approvalContinuation) {
    return message.parts.filter(isApprovalContinuationContextPart);
  }
  if (segmentContinuation) {
    return message.parts.filter(isSegmentContinuationContextPart);
  }

  const textParts = message.parts.filter((part) => {
    return part.type === "text" && part.text.trim().length > 0;
  });
  return textParts;
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

function appendModelOnlyContextMessage(
  messages: ModelMessage[],
  continuationNote: string,
): ModelMessage[] {
  const text = continuationNote.trim();
  if (!text) return messages;
  return [
    ...messages,
    {
      role: "assistant",
      content: [
        "Model-only continuation note:",
        text,
      ].join("\n"),
    },
  ];
}

function addModelOnlyContextMessage(
  messages: ModelMessage[],
  context: {
    sessionContextDigest: string | undefined;
    workspaceContextDigest: string | undefined;
  },
): ModelMessage[] {
  const text = modelOnlyContextMessageText(context);
  if (!text) return messages;
  const contextMessage: ModelMessage = {
    role: "assistant",
    content: text,
  };
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  if (latestUserIndex === -1) return [...messages, contextMessage];
  return [
    ...messages.slice(0, latestUserIndex),
    contextMessage,
    ...messages.slice(latestUserIndex),
  ];
}

function addSingleFileTargetContextMessage(
  messages: ModelMessage[],
  contextText: string,
): ModelMessage[] {
  const text = contextText.trim();
  if (!text) return messages;
  const contextMessage: ModelMessage = {
    role: "assistant",
    content: text,
  };
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  if (latestUserIndex === -1) return [...messages, contextMessage];
  return [
    ...messages.slice(0, latestUserIndex),
    contextMessage,
    ...messages.slice(latestUserIndex),
  ];
}

function modelOnlyContextMessageText({
  sessionContextDigest,
  workspaceContextDigest,
}: {
  sessionContextDigest: string | undefined;
  workspaceContextDigest: string | undefined;
}): string | undefined {
  const blocks = [workspaceContextDigest, sessionContextDigest]
    .map((block) => block?.trim())
    .filter((block): block is string => Boolean(block));
  if (blocks.length === 0) return undefined;
  return [
    "Model-only context for this run:",
    ...blocks,
    "",
    "Use this context for orientation and continuity. Re-read files or rerun commands when exact current state matters.",
  ].join("\n");
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

function isSegmentContinuationContextPart(
  part: AntonUIMessage["parts"][number],
): boolean {
  if (part.type === "text") {
    return part.text.trim().length > 0;
  }
  if (!("state" in part) || typeof part.state !== "string") return false;
  return (
    part.state === "output-available" ||
    part.state === "output-error" ||
    part.state === "output-denied" ||
    part.state === "approval-responded"
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
  profile,
  mode,
  startedAt,
  workspaceRoot,
  responseKind,
  permissionMode,
  thinkingEnabled,
  openRouterRouting,
  profileHandoffContinuationOfRunId,
}: {
  writer: UIMessageStreamWriter<AntonUIMessage>;
  runId: string;
  model: string;
  profile: AgentRunProfile;
  mode: AgentRunMode;
  startedAt: number;
  workspaceRoot?: string;
  responseKind?: "plan";
  permissionMode: PermissionMode;
  thinkingEnabled: boolean;
  openRouterRouting?: OpenRouterRoutingResolution;
  profileHandoffContinuationOfRunId?: string;
}) {
  let sequence = 0;
  let loopGuardCount = 0;
  let verificationSummary: string | undefined;
  let stepCount = 0;
  let finalized = false;
  let stateChangingEditSucceeded = false;
  let promotionReason: string | undefined;
  const effectiveProfile: AgentRunProfile = profile;
  const events = new Map<string, AntonActivityEvent>();
  const reasoningBuffers = new Map<string, string>();
  const activeReasoningEventIds = new Map<string, string>();
  const reasoningOccurrences = new Map<string, number>();

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
    const metadataExtra = { ...extra };
    delete metadataExtra.costMetadata;
    const data: AntonRunData = {
      runId,
      model,
      status,
      startedAt,
      ...extra,
    };
    writeMetadata(status, metadataExtra);
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

  const summarizeInput = (input: unknown): string | undefined =>
    summarizeToolInput(input, auditSummary);

  const summarizeOutput = (
    toolName: string,
    output: unknown,
    error: unknown,
  ): string | undefined =>
    summarizeToolOutput(toolName, output, error, auditSummary);

  const outputExitCode = (output: unknown): number | null => {
    const exitCode = sharedOutputExitCode(output);
    return exitCode ?? null;
  };

  const toolError = (success: boolean, output: unknown, error: unknown): string | null => {
    const thrown = errorMessageOrUndefined(error);
    if (thrown) return auditSummary(thrown);
    if (!success) return "Tool execution failed";
    if (typeof output !== "object" || output === null) return null;
    const record = output as Record<string, unknown>;
    if (record.ok === false) {
      if (typeof record.error === "string") return auditSummary(record.error);
      if (typeof record.message === "string") return auditSummary(record.message);
      return "Tool returned ok: false";
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
    if (name === "write_file" && summary) return `Created ${summary}`;
    if (name === "edit_file" && summary) return `Patched ${summary}`;
    if (name === "edit_text" && summary) return `Edited ${summary}`;
    if (name === "replace_text" && summary) return `Replaced text in ${summary}`;
    if (name === "replace_lines" && summary) return `Replaced lines in ${summary}`;
    if (name === "multi_replace_text" && summary) return `Replaced text in ${summary}`;
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
      loopGuardIncomplete?: boolean;
      unverifiedEdit?: boolean;
      verificationFailed?: boolean;
      profileHandoffRequired?: boolean;
      profileHandoff?: ProfilePromotionEvent;
      tokenAudit?: TokenAudit;
      stepProviderMetadata?: ProviderMetadata[];
    } = {},
  ) => {
    if (finalized) return;
    finalized = true;
    settleRunningEvents(status === "completed" ? "completed" : "error");
    const finishedAt = Date.now();
    const durationMs = Math.max(0, finishedAt - startedAt);
    const inputTokens = usage?.inputTokens;
    const outputTokens = usage?.outputTokens;
    const totalTokens = usage?.totalTokens;
    const costUsd = openRouterCostFromMetadata(
      providerMetadata,
      limits.stepProviderMetadata,
    );
    const tokenUsage = buildTokenUsageMetrics({
      usage,
      providerMetadata,
      stepProviderMetadata: limits.stepProviderMetadata,
    });
    const costMetadata = runCostMetadata(
      providerMetadata,
      limits.tokenAudit,
      tokenUsage,
      limits.stepProviderMetadata,
      {
        profile,
        mode,
        model,
        permissionMode,
        thinkingEnabled,
        ...(openRouterRouting ? { openRouterRouting } : {}),
        profileHandoffContinuationOfRunId,
        loopGuardCount:
          limits.tokenAudit?.loopGuardCount ?? loopGuardCount,
        verificationSummary,
        cacheHitRate: limits.tokenAudit?.promptCache?.cacheHitRate,
        promotionReason:
          limits.tokenAudit?.promotionReason ?? promotionReason,
        effectiveProfile:
          limits.tokenAudit?.effectiveProfile ?? effectiveProfile,
        hadSuccessfulEdit: stateChangingEditSucceeded,
        profileHandoffRequired: limits.profileHandoffRequired,
        handoffFromProfile: limits.profileHandoff?.fromProfile,
        handoffToProfile: limits.profileHandoff?.toProfile,
        handoffReason: limits.profileHandoff?.reason,
        targetPath: limits.tokenAudit?.targetPath,
        targetResolution: limits.tokenAudit?.targetResolution,
        targetResolutionReason: limits.tokenAudit?.targetResolutionReason,
      },
    );
    const storedFinishReason = limits.profileHandoffRequired
        ? "profile_handoff_required"
      : limits.verificationFailed
        ? "verification_failed"
      : limits.unverifiedEdit
        ? "unverified_edit"
      : limits.loopGuardIncomplete
        ? "loop_guard_incomplete"
      : finishReason;
    writeRun(status, {
      finishedAt,
      durationMs,
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      costMetadata,
      stepCount,
      finishReason: storedFinishReason,
      profile,
      mode,
      cacheHitRate: limits.tokenAudit?.promptCache?.cacheHitRate,
      loopGuardCount: limits.tokenAudit?.loopGuardCount ?? loopGuardCount,
      verificationSummary,
      ...(limits.profileHandoffRequired
        ? {
            profileHandoffRequired: true,
            handoffFromProfile: limits.profileHandoff?.fromProfile,
            handoffToProfile: limits.profileHandoff?.toProfile,
            handoffReason: limits.profileHandoff?.reason,
          }
        : {}),
      ...(limits.tokenAudit?.promotionReason ?? promotionReason
        ? {
            promotionReason:
              limits.tokenAudit?.promotionReason ?? promotionReason,
          }
        : {}),
      ...(limits.tokenAudit?.effectiveProfile ?? effectiveProfile
        ? {
            effectiveProfile:
              limits.tokenAudit?.effectiveProfile ?? effectiveProfile,
          }
        : {}),
      hadSuccessfulEdit: stateChangingEditSucceeded,
      rawTotalTokens: tokenUsage?.rawTotalTokens ?? totalTokens,
      effectiveTokens: tokenUsage?.effectiveTokens,
    });
    if (limits.loopGuardIncomplete && !limits.unverifiedEdit && !limits.verificationFailed) {
      startEvent({
        id: `${runId}:loop-guard-incomplete:${sequence + 1}`,
        kind: "error",
        status: "error",
        label: "Run stopped before edits",
        summary:
          "Loop guards stopped tool use before any file edit succeeded. Treat the final answer as incomplete until an edit and verify succeed.",
        details: {
          finishReason: storedFinishReason,
          stepCount,
          loopGuardCount: limits.tokenAudit?.loopGuardCount ?? loopGuardCount,
        },
      });
    }
    if (limits.verificationFailed) {
      startEvent({
        id: `${runId}:verification-failed:${sequence + 1}`,
        kind: "error",
        status: "error",
        label: "Verification failed after edit",
        summary:
          verificationSummary ??
          "At least one file edit succeeded and verify ran, but verification failed before the run ended.",
        details: {
          finishReason: storedFinishReason,
          stepCount,
        },
      });
    }
    if (limits.unverifiedEdit) {
      startEvent({
        id: `${runId}:unverified-edit:${sequence + 1}`,
        kind: "error",
        status: "error",
        label: "Edit completed without verification",
        summary:
          "At least one file edit succeeded, but verify did not run before the run ended. Treat the final answer as incomplete until verify succeeds.",
        details: {
          finishReason: storedFinishReason,
          stepCount,
        },
      });
    }
    updateRun(runId, {
      status,
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
    noteContextBudget(report: ContextBudgetReport) {
      if (report.droppedMessages <= 0) return;
      startEvent({
        id: `${runId}:context-budget:${sequence + 1}`,
        kind: "progress",
        status: "completed",
        label: "Context window trimmed",
        summary: `Kept ${report.preservedMessages} message${report.preservedMessages === 1 ? "" : "s"} and dropped ${report.droppedMessages} older message${report.droppedMessages === 1 ? "" : "s"} before the model call.`,
        details: { contextBudget: report },
      });
    },
    noteModelSelection(summary: string) {
      startEvent({
        id: `${runId}:model-selection:${sequence + 1}`,
        kind: "progress",
        status: "completed",
        label: "Model selection preserved",
        summary,
      });
    },
    noteMcpWarnings(warnings: readonly string[]) {
      if (warnings.length === 0) return;
      startEvent({
        id: `${runId}:mcp-warnings:${sequence + 1}`,
        kind: "progress",
        status: "completed",
        label: "MCP servers skipped",
        summary: `${warnings.length} MCP warning${warnings.length === 1 ? "" : "s"} recorded before tool loading completed.`,
        details: { mcpWarnings: warnings.slice(0, 20) },
      });
    },
    noteTargetResolution(resolution: SingleFileTargetResolution | undefined) {
      if (!resolution) return;
      const target =
        "targetPath" in resolution ? resolution.targetPath : undefined;
      startEvent({
        id: `${runId}:target-resolution:${sequence + 1}`,
        kind: "progress",
        status: "completed",
        label: "Single-file target resolution",
        summary: target
          ? `${resolution.targetResolution}: ${target}`
          : resolution.targetResolutionReason,
        details: {
          targetResolution: {
            ...resolution,
            routedProfile: profile,
          },
        },
      });
    },
    noteProfilePromotion(event: ProfilePromotionEvent) {
      promotionReason = event.reason;
      startEvent({
        id: `${runId}:profile-promotion:${sequence + 1}`,
        kind: "progress",
        status: "completed",
        label: "Profile needs full Agent segment",
        summary: event.reason,
        details: {
          profileHandoff: {
            fromProfile: event.fromProfile,
            toProfile: event.toProfile,
            reason: event.reason,
          },
        },
      });
    },
    noteLoopGuard(event: {
      reason: string;
      blockedTools: string[];
      affectedPath?: string;
      phase?: string;
      failureCode?: string;
      recommendedNext?: string;
      forceFinal: boolean;
    }) {
      loopGuardCount += 1;
      startEvent({
        id: `${runId}:loop-guard:${sequence + 1}`,
        kind: "progress",
        status: "completed",
        label: "Loop guard activated",
        summary: event.reason,
        details: {
          loopGuard: {
            reason: event.reason,
            blockedTools: event.blockedTools,
            ...(event.affectedPath ? { affectedPath: event.affectedPath } : {}),
            ...(event.phase ? { phase: event.phase } : {}),
            ...(event.failureCode ? { failureCode: event.failureCode } : {}),
            ...(event.recommendedNext
              ? { recommendedNext: event.recommendedNext }
              : {}),
            forceFinal: event.forceFinal,
          },
        },
      });
    },
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
    updateStepUsage(steps: NonNullable<TokenAudit["steps"]>) {
      writeRun("running", {
        costMetadata: {
          tokenAudit: {
            profile,
            steps,
          },
        },
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

      const approval = workspaceRoot
        ? buildToolApprovalMetadata({
            toolName: event.toolName,
            input: event.input,
            workspaceRoot,
            permissionMode,
          })
        : undefined;
      if (approval) {
        details.approval = redactValue(approval);
        details.riskCategories = [...approval.riskCategories];
        details.riskSummary = approval.summary;
      }

      if (event.toolName === "bash") {
        const classification = preClassifyBashInput(event.input, {
          workspaceRoot,
        });
        const commandPolicyMode = commandPolicyModeForPermission(permissionMode);
        details.commandPolicyMode = commandPolicyMode;
        if (classification) {
          details.bashClassification = {
            categories: [...classification.categories],
            forbidden: classification.forbidden,
            reason: classification.reason,
            commandPolicyMode,
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
      if (
        event.success &&
        isStateChangingEditTool(event.toolName) &&
        isRecord(event.output) &&
        event.output.ok === true
      ) {
        stateChangingEditSucceeded = true;
      }
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
          ...(event.toolName === "read_file" &&
          isRecord(event.output) &&
          event.success
            ? {
                durableOutput: event.output,
                modelVisibleOutput: compactReadFileForModel(
                  event.output,
                  profile,
                ),
              }
            : {}),
        },
      });
      const currentApproval = structuredApprovalDetails(current?.details?.approval);
      const toolCallUpdate: Parameters<typeof updateToolCall>[1] = {
        status,
        outputSummary: summarizeOutput(event.toolName, event.output, event.error) ?? null,
        exitCode: outputExitCode(event.output),
        error,
        finishedAt: new Date(),
        durationMs: event.durationMs,
      };
      if (currentApproval) toolCallUpdate.approvalDecision = "approved";
      updateToolCall(`${runId}:tool:${event.toolCallId}`, toolCallUpdate);
      if (event.toolName === "verify" && isRecord(event.output)) {
        const summary = event.output.summary;
        if (typeof summary === "string") verificationSummary = summary;
      }
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
      const todos = todoItemsFromToolOutput(event.toolName, event.output, event.success);
      if (todos) writeTodos(todos);
    },
    handleStreamPart(part: TextStreamPart<ToolSet>) {
      if (part.type === "reasoning-delta") {
        const eventId = activeReasoningEventIds.get(part.id);
        const bufferId = eventId ?? `${runId}:reasoning:${part.id}`;
        reasoningBuffers.set(
          bufferId,
          `${reasoningBuffers.get(bufferId) ?? ""}${part.text}`,
        );
      }
      if (part.type === "reasoning-start") {
        const occurrence = (reasoningOccurrences.get(part.id) ?? 0) + 1;
        reasoningOccurrences.set(part.id, occurrence);
        const eventId = `${runId}:reasoning:${part.id}:${occurrence}`;
        activeReasoningEventIds.set(part.id, eventId);
        startEvent({
          id: eventId,
          kind: "reasoning",
          label: "Thinking",
          details: {
            reasoningPartId: part.id,
            reasoningOccurrence: occurrence,
          },
        });
      }
      if (part.type === "reasoning-end") {
        const eventId =
          activeReasoningEventIds.get(part.id) ??
          `${runId}:reasoning:${part.id}`;
        const summary = reasoningBuffers.get(eventId)?.trim();
        reasoningBuffers.delete(eventId);
        activeReasoningEventIds.delete(part.id);
        finishEvent(eventId, {
          status: "completed",
          label: "Thought",
          ...(summary ? { summary: redactText(summary) } : {}),
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
  success: boolean,
): AntonTodoItem[] | undefined {
  if (toolName !== "update_todos" || !success) return undefined;
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

function openRouterCostMetadata(
  providerMetadata: ProviderMetadata | undefined,
  stepProviderMetadata: ProviderMetadata[] | undefined,
): Record<string, unknown> | null {
  const openrouter = providerMetadata?.openrouter;
  const usage = isRecord(openrouter) && isRecord(openrouter.usage)
    ? openrouter.usage
    : null;
  const stepUsage = (stepProviderMetadata ?? []).flatMap((metadata, index) => {
    const stepOpenrouter = metadata.openrouter;
    if (!isRecord(stepOpenrouter) || !isRecord(stepOpenrouter.usage)) return [];
    return [{ stepNumber: index, usage: stepOpenrouter.usage }];
  });
  if (!usage && stepUsage.length === 0) return null;
  return redactValue({
    provider: "openrouter",
    source:
      stepUsage.length > 0
        ? "providerMetadata.openrouter.usage.steps"
        : "providerMetadata.openrouter.usage",
    ...(usage ? { usage } : {}),
    ...(stepUsage.length > 0 ? { stepUsage } : {}),
  }) as Record<string, unknown>;
}

function runCostMetadata(
  providerMetadata: ProviderMetadata | undefined,
  tokenAudit: TokenAudit | undefined,
  tokenUsage: TokenUsageMetrics | undefined,
  stepProviderMetadata: ProviderMetadata[] | undefined,
  execution: {
    profile: AgentRunProfile;
    mode: AgentRunMode;
    model: string;
    permissionMode: PermissionMode;
    thinkingEnabled: boolean;
    profileHandoffContinuationOfRunId?: string;
    loopGuardCount: number;
    verificationSummary?: string;
    cacheHitRate?: number;
    promotionReason?: string;
    effectiveProfile?: AgentRunProfile;
    hadSuccessfulEdit?: boolean;
    profileHandoffRequired?: boolean;
    handoffFromProfile?: "localized-edit" | "single-file-edit";
    handoffToProfile?: "general-chat";
    handoffReason?: string;
    targetPath?: string;
    targetResolution?: "exact" | "unique_search" | "unresolved" | "ambiguous";
    targetResolutionReason?: string;
    openRouterRouting?: OpenRouterRoutingResolution;
  },
): Record<string, unknown> | null {
  const providerCostMetadata = openRouterCostMetadata(
    providerMetadata,
    stepProviderMetadata,
  );
  if (!tokenAudit && !tokenUsage && !providerCostMetadata) {
    return redactValue({
      execution: {
        profile: execution.profile,
        mode: execution.mode,
        model: execution.model,
        permissionMode: execution.permissionMode,
        thinkingEnabled: execution.thinkingEnabled,
        ...(execution.openRouterRouting
          ? { openRouterRouting: execution.openRouterRouting }
          : {}),
        ...(execution.profileHandoffContinuationOfRunId
          ? {
              profileHandoffContinuationOfRunId:
                execution.profileHandoffContinuationOfRunId,
            }
          : {}),
        loopGuardCount: execution.loopGuardCount,
        ...(execution.verificationSummary
          ? { verificationSummary: execution.verificationSummary }
          : {}),
        ...(execution.cacheHitRate !== undefined
          ? { cacheHitRate: execution.cacheHitRate }
          : {}),
        ...(execution.promotionReason
          ? { promotionReason: execution.promotionReason }
          : {}),
        ...(execution.effectiveProfile
          ? { effectiveProfile: execution.effectiveProfile }
          : {}),
        ...(execution.hadSuccessfulEdit !== undefined
          ? { hadSuccessfulEdit: execution.hadSuccessfulEdit }
          : {}),
        ...(execution.profileHandoffRequired !== undefined
          ? { profileHandoffRequired: execution.profileHandoffRequired }
          : {}),
        ...(execution.handoffFromProfile
          ? { handoffFromProfile: execution.handoffFromProfile }
          : {}),
        ...(execution.handoffToProfile
          ? { handoffToProfile: execution.handoffToProfile }
          : {}),
        ...(execution.handoffReason
          ? { handoffReason: execution.handoffReason }
          : {}),
        ...(execution.targetPath ? { targetPath: execution.targetPath } : {}),
        ...(execution.targetResolution
          ? { targetResolution: execution.targetResolution }
          : {}),
        ...(execution.targetResolutionReason
          ? { targetResolutionReason: execution.targetResolutionReason }
          : {}),
      },
    }) as Record<string, unknown>;
  }
  return redactValue({
    ...(providerCostMetadata ?? {}),
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(tokenAudit ? { tokenAudit } : {}),
    execution: {
      profile: execution.profile,
      mode: execution.mode,
      model: execution.model,
      permissionMode: execution.permissionMode,
      thinkingEnabled: execution.thinkingEnabled,
      ...(execution.openRouterRouting
        ? { openRouterRouting: execution.openRouterRouting }
        : {}),
      ...(execution.profileHandoffContinuationOfRunId
        ? {
            profileHandoffContinuationOfRunId:
              execution.profileHandoffContinuationOfRunId,
          }
        : {}),
      loopGuardCount: execution.loopGuardCount,
      ...(execution.verificationSummary
        ? { verificationSummary: execution.verificationSummary }
        : {}),
      ...(execution.cacheHitRate !== undefined
        ? { cacheHitRate: execution.cacheHitRate }
        : {}),
      ...(execution.promotionReason
        ? { promotionReason: execution.promotionReason }
        : {}),
      ...(execution.effectiveProfile
        ? { effectiveProfile: execution.effectiveProfile }
        : {}),
      ...(execution.hadSuccessfulEdit !== undefined
        ? { hadSuccessfulEdit: execution.hadSuccessfulEdit }
        : {}),
      ...(execution.profileHandoffRequired !== undefined
        ? { profileHandoffRequired: execution.profileHandoffRequired }
        : {}),
      ...(execution.handoffFromProfile
        ? { handoffFromProfile: execution.handoffFromProfile }
        : {}),
      ...(execution.handoffToProfile
        ? { handoffToProfile: execution.handoffToProfile }
        : {}),
      ...(execution.handoffReason
        ? { handoffReason: execution.handoffReason }
        : {}),
      ...(execution.targetPath ? { targetPath: execution.targetPath } : {}),
      ...(execution.targetResolution
        ? { targetResolution: execution.targetResolution }
        : {}),
      ...(execution.targetResolutionReason
        ? { targetResolutionReason: execution.targetResolutionReason }
        : {}),
    },
  }) as Record<string, unknown>;
}

function runEligibleForProfileHandoffContinuation(run: {
  status: string;
  finishReason: string | null;
  costMetadata: unknown;
}): boolean {
  if (run.status !== "completed") return false;
  if (run.finishReason !== "profile_handoff_required") return false;
  const handoff = profileHandoffFromCostMetadata(run.costMetadata);
  return (
    handoff.profileHandoffRequired === true &&
    (handoff.handoffFromProfile === "localized-edit" ||
      handoff.handoffFromProfile === "single-file-edit") &&
    handoff.handoffToProfile === "general-chat"
  );
}

function shouldAttemptSingleFileEditRouting({
  mode,
  profile,
  latestUserText,
  isSegmentContinuation,
  approvalContinuation,
}: {
  mode: ChatMode;
  profile: AgentRunProfile;
  latestUserText: string;
  isSegmentContinuation: boolean;
  approvalContinuation: boolean;
}): boolean {
  if (mode !== "agent") return false;
  if (isSegmentContinuation || approvalContinuation) return false;
  if (
    profile === "accepted-plan-simple" ||
    profile === "accepted-plan-general" ||
    profile === "command-run"
  ) {
    return false;
  }
  const normalized = latestUserText.trim().toLowerCase();
  return isImplementationRequest(normalized) && !isBroadScopeRequest(normalized);
}

function singleFileTargetMetadata(
  resolution: SingleFileTargetResolution | undefined,
): Record<string, unknown> | undefined {
  if (!resolution) return undefined;
  return {
    ...("targetPath" in resolution ? { targetPath: resolution.targetPath } : {}),
    targetResolution: resolution.targetResolution,
    targetResolutionReason: resolution.targetResolutionReason,
  };
}

function singleFileTargetResolutionFromCostMetadata(
  costMetadata: unknown,
): SingleFileTargetResolution | undefined {
  if (!isRecord(costMetadata)) return undefined;
  const execution = isRecord(costMetadata.execution)
    ? costMetadata.execution
    : undefined;
  if (!execution) return undefined;
  const targetPath = execution.targetPath;
  const targetResolution = execution.targetResolution;
  const targetResolutionReason = execution.targetResolutionReason;
  if (
    typeof targetPath !== "string" ||
    (targetResolution !== "exact" && targetResolution !== "unique_search")
  ) {
    return undefined;
  }
  return {
    targetPath,
    targetResolution,
    targetResolutionReason:
      typeof targetResolutionReason === "string"
        ? targetResolutionReason
        : "inherited single-file target from previous segment",
    candidates: [targetPath],
  };
}

function resolveRunProfile({
  mode,
  messages,
  approvalContinuation,
  profileHandoffRun,
}: {
  mode: ChatMode;
  messages: AntonUIMessage[];
  approvalContinuation: boolean;
  profileHandoffRun: ReturnType<typeof getRunById> | undefined;
}): AgentRunProfile {
  if (profileHandoffRun) {
    return (
      profileHandoffFromCostMetadata(profileHandoffRun.costMetadata)
        .handoffToProfile ?? classifyRunProfile(mode, latestUserText(messages))
    );
  }
  if (approvalContinuation) {
    const runId = runIdFromAssistantMessage(messages.at(-1));
    const originatingRun = runId ? getRunById(runId) : undefined;
    return (
      executionProfileFromCostMetadata(originatingRun?.costMetadata) ??
      classifyRunProfile(mode, latestUserText(messages))
    );
  }
  return classifyRunProfile(mode, latestUserText(messages));
}

function profileHandoffFromCostMetadata(costMetadata: unknown): {
  profileHandoffRequired?: boolean;
  handoffFromProfile?: "localized-edit" | "single-file-edit";
  handoffToProfile?: "general-chat";
  handoffReason?: string;
} {
  if (!isRecord(costMetadata)) return {};
  const execution = isRecord(costMetadata.execution)
    ? costMetadata.execution
    : undefined;
  if (!execution) return {};
  return {
    ...(execution.profileHandoffRequired === true
      ? { profileHandoffRequired: true }
      : {}),
    ...(execution.handoffFromProfile === "localized-edit" ||
    execution.handoffFromProfile === "single-file-edit"
      ? { handoffFromProfile: execution.handoffFromProfile }
      : {}),
    ...(execution.handoffToProfile === "general-chat"
      ? { handoffToProfile: "general-chat" as const }
      : {}),
    ...(typeof execution.handoffReason === "string"
      ? { handoffReason: execution.handoffReason }
      : {}),
  };
}

function profileHandoffContinuationOfRunId(
  costMetadata: unknown,
): string | undefined {
  if (!isRecord(costMetadata)) return undefined;
  const execution = isRecord(costMetadata.execution)
    ? costMetadata.execution
    : undefined;
  const runId = execution?.profileHandoffContinuationOfRunId;
  return typeof runId === "string" && runId.length > 0 ? runId : undefined;
}

function permissionModeFromCostMetadata(
  costMetadata: unknown,
): PermissionMode | undefined {
  if (!isRecord(costMetadata)) return undefined;
  const execution = isRecord(costMetadata.execution)
    ? costMetadata.execution
    : undefined;
  const permissionMode = execution?.permissionMode;
  return permissionMode === "default" ||
    permissionMode === "auto-review" ||
    permissionMode === "full-access"
    ? permissionMode
    : undefined;
}

function thinkingEnabledFromCostMetadata(
  costMetadata: unknown,
): boolean | undefined {
  if (!isRecord(costMetadata)) return undefined;
  const execution = isRecord(costMetadata.execution)
    ? costMetadata.execution
    : undefined;
  return typeof execution?.thinkingEnabled === "boolean"
    ? execution.thinkingEnabled
    : undefined;
}

function profileHandoffContinuationNote(costMetadata: unknown): string {
  const handoff = profileHandoffFromCostMetadata(costMetadata);
  return [
    "Profile handoff continuation preserves the originating transcript prefix and prior tool history for prompt-cache reuse.",
    `Continue as ${handoff.handoffToProfile ?? "general-chat"} after ${handoff.handoffFromProfile ?? "localized-edit"} needed broader tools.`,
    handoff.handoffReason
      ? `Handoff reason: ${handoff.handoffReason}`
      : "Handoff reason: fast-edit scope exceeded.",
    "Use the broader Agent tools now; do not repeat completed reads or edits unless current state must be verified.",
  ].join(" ");
}

function profileHandoffTransitionLabel(costMetadata: unknown): string {
  const handoff = profileHandoffFromCostMetadata(costMetadata);
  return `Intentional profile handoff: ${handoff.handoffFromProfile ?? "localized-edit"} -> ${handoff.handoffToProfile ?? "general-chat"}.`;
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

function isStateChangingEditTool(toolName: string): boolean {
  return (
    toolName === "edit_file" ||
    toolName === "edit_text" ||
    toolName === "replace_text" ||
    toolName === "replace_lines" ||
    toolName === "multi_replace_text" ||
    toolName === "write_file"
  );
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
