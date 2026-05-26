import type {
  Run,
  RunContextSummary,
  RunEvent,
  ToolApproval,
  ToolCall,
} from "@/src/db/schema";
import {
  getNativeToolPermissionMetadata,
  TOOL_RISK_CATEGORIES,
  type ToolRiskCategory,
} from "@/src/agent/permissions";
import { redactText } from "@/src/lib/redaction";
import { tokenUsageFromCostMetadata } from "@/src/lib/token-usage";
import type {
  ProjectRunDetailsApproval,
  ProjectRunDetailsContext,
  ProjectRunDetailsContextCommand,
  ProjectRunDetailsContextComposition,
  ProjectRunDetailsContextFile,
  ProjectRunDetailsContextTool,
  ProjectRunDetailsEvent,
  ProjectRunDetailsPromptCache,
  ProjectRunDetailsRun,
  ProjectRunDetailsStepUsage,
  ProjectRunDetailsSummary,
  ProjectRunDetailsToolCall,
} from "./api-types";

export function serializeProjectRunDetails(input: {
  run: Run;
  events: RunEvent[];
  toolCalls: ToolCall[];
  approvals: ToolApproval[];
  context: RunContextSummary | undefined;
  segmentRuns?: Run[];
}): ProjectRunDetailsSummary {
  const segments =
    input.segmentRuns && input.segmentRuns.length > 0
      ? input.segmentRuns
      : [input.run];
  const displayRun =
    segments.length > 1 ? aggregateTurnRunMetrics(input.run, segments) : input.run;

  return {
    run: serializeProjectRunDetailsRun(displayRun),
    events: input.events.map(serializeProjectRunDetailsEvent),
    toolCalls: input.toolCalls.map((toolCall) =>
      serializeProjectRunDetailsToolCall(
        toolCall,
        input.approvals.find((approval) => approval.toolCallId === toolCall.id),
      ),
    ),
    approvals: input.approvals.map(serializeProjectRunDetailsApproval),
    context: serializeProjectRunDetailsContext(input.context),
    ...(segments.length > 1 ? { segmentCount: segments.length } : {}),
  };
}

function aggregateTurnRunMetrics(anchorRun: Run, segments: readonly Run[]): Run {
  const startedAt = segments[0]?.startedAt ?? anchorRun.startedAt;
  const finishedAt =
    segments.at(-1)?.finishedAt ?? anchorRun.finishedAt ?? null;
  const durationMs = segments.reduce(
    (sum, run) => sum + (run.durationMs ?? 0),
    0,
  );
  const stepCount = segments.reduce(
    (sum, run) => sum + (run.stepCount ?? 0),
    0,
  );
  const inputTokens = segments.reduce(
    (sum, run) => sum + (run.inputTokens ?? 0),
    0,
  );
  const outputTokens = segments.reduce(
    (sum, run) => sum + (run.outputTokens ?? 0),
    0,
  );
  const totalTokens = segments.reduce(
    (sum, run) => sum + (run.totalTokens ?? 0),
    0,
  );
  const costUsd = segments.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);

  return {
    ...anchorRun,
    startedAt,
    finishedAt,
    durationMs: durationMs > 0 ? durationMs : anchorRun.durationMs,
    stepCount: stepCount > 0 ? stepCount : anchorRun.stepCount,
    inputTokens: inputTokens > 0 ? inputTokens : anchorRun.inputTokens,
    outputTokens: outputTokens > 0 ? outputTokens : anchorRun.outputTokens,
    totalTokens: totalTokens > 0 ? totalTokens : anchorRun.totalTokens,
    costUsd: costUsd > 0 ? costUsd : anchorRun.costUsd,
  };
}

function serializeProjectRunDetailsRun(run: Run): ProjectRunDetailsRun {
  const costMetadata = isRecord(run.costMetadata) ? run.costMetadata : null;
  const tokenUsage = tokenUsageFromCostMetadata(costMetadata);
  const tokenAudit = isRecord(costMetadata?.tokenAudit)
    ? costMetadata.tokenAudit
    : null;
  const contextComposition = contextCompositionFromTokenAudit(tokenAudit);
  const stepUsage = stepUsageFromTokenAudit(tokenAudit);
  const promptCache = promptCacheFromTokenAudit(tokenAudit);
  const reasoningTokens = finiteNumber(
    isRecord(tokenAudit?.usage) ? tokenAudit.usage.reasoningTokens : undefined,
  );
  const execution = isRecord(costMetadata?.execution)
    ? costMetadata.execution
    : null;

  return {
    id: run.id,
    sessionId: run.sessionId,
    status: run.status,
    model: run.model,
    provider: run.provider ?? null,
    startedAt: run.startedAt.getTime(),
    finishedAt: run.finishedAt?.getTime() ?? null,
    durationMs: run.durationMs ?? null,
    stepCount: run.stepCount ?? null,
    finishReason: run.finishReason ?? null,
    inputTokens: run.inputTokens ?? null,
    outputTokens: run.outputTokens ?? null,
    totalTokens: run.totalTokens ?? null,
    costUsd: run.costUsd ?? null,
    ...(tokenUsage || reasoningTokens !== undefined
      ? {
          tokenUsage: {
            ...(tokenUsage?.rawInputTokens !== undefined
              ? { rawInputTokens: tokenUsage.rawInputTokens }
              : {}),
            ...(tokenUsage?.uncachedInputTokens !== undefined
              ? { uncachedInputTokens: tokenUsage.uncachedInputTokens }
              : {}),
            ...(tokenUsage?.cachedInputTokens !== undefined
              ? { cachedInputTokens: tokenUsage.cachedInputTokens }
              : {}),
            ...(tokenUsage?.cacheWriteTokens !== undefined
              ? { cacheWriteTokens: tokenUsage.cacheWriteTokens }
              : {}),
            ...(tokenUsage?.effectiveInputTokens !== undefined
              ? { effectiveInputTokens: tokenUsage.effectiveInputTokens }
              : {}),
            ...(tokenUsage?.outputTokens !== undefined
              ? { outputTokens: tokenUsage.outputTokens }
              : run.outputTokens !== null
                ? { outputTokens: run.outputTokens }
                : {}),
            ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
            ...(tokenUsage?.effectiveTokens !== undefined
              ? { effectiveTokens: tokenUsage.effectiveTokens }
              : {}),
            ...(tokenUsage?.providerEffectiveTokens !== undefined
              ? { providerEffectiveTokens: tokenUsage.providerEffectiveTokens }
              : {}),
          },
        }
      : {}),
    ...(contextComposition ? { contextComposition } : {}),
    ...(stepUsage.length > 0 ? { stepUsage } : {}),
    ...(promptCache ? { promptCache } : {}),
    ...(typeof execution?.profile === "string" ? { profile: execution.profile } : {}),
    ...(typeof execution?.mode === "string" ? { mode: execution.mode } : {}),
    ...(finiteNumber(execution?.tokenBudgetMultiplier) !== undefined
      ? { tokenBudgetMultiplier: finiteNumber(execution?.tokenBudgetMultiplier) }
      : {}),
    ...(finiteNumber(execution?.cacheHitRate) !== undefined
      ? { cacheHitRate: finiteNumber(execution?.cacheHitRate) }
      : {}),
    ...(finiteNumber(execution?.loopGuardCount) !== undefined
      ? { loopGuardCount: finiteNumber(execution?.loopGuardCount) }
      : {}),
    ...(typeof execution?.verificationSummary === "string"
      ? { verificationSummary: execution.verificationSummary }
      : {}),
    ...(typeof execution?.promotionReason === "string"
      ? { promotionReason: execution.promotionReason }
      : {}),
    ...(typeof execution?.effectiveProfile === "string"
      ? { effectiveProfile: execution.effectiveProfile }
      : {}),
    ...(execution?.hadSuccessfulEdit === true || execution?.hadSuccessfulEdit === false
      ? { hadSuccessfulEdit: execution.hadSuccessfulEdit === true }
      : {}),
    ...(tokenUsage?.rawTotalTokens !== undefined
      ? { rawTotalTokens: tokenUsage.rawTotalTokens }
      : run.totalTokens !== null
        ? { rawTotalTokens: run.totalTokens }
        : {}),
    ...(tokenUsage?.effectiveTokens !== undefined
      ? { effectiveTokens: tokenUsage.effectiveTokens }
      : {}),
  };
}

function serializeProjectRunDetailsEvent(event: RunEvent): ProjectRunDetailsEvent {
  return {
    id: event.id,
    sequence: event.sequence,
    kind: event.kind,
    status: event.status,
    label: redactText(event.label),
    summary: event.summary ? redactText(event.summary) : null,
    startedAt: event.startedAt.getTime(),
    durationMs: event.durationMs ?? null,
    toolCallId: event.toolCallId ?? null,
  };
}

function serializeProjectRunDetailsToolCall(
  toolCall: ToolCall,
  approval: ToolApproval | undefined,
): ProjectRunDetailsToolCall {
  return {
    id: toolCall.id,
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    stepNumber: toolCall.stepNumber ?? null,
    status: toolCall.status,
    approvalDecision: toolCall.approvalDecision ?? null,
    permissionLabel: derivePermissionLabel(toolCall.toolName, approval),
    inputSummary: toolCall.inputSummary ? redactText(toolCall.inputSummary) : null,
    outputSummary: toolCall.outputSummary
      ? redactText(toolCall.outputSummary)
      : null,
    exitCode: toolCall.exitCode ?? null,
    error: toolCall.error ? redactText(toolCall.error) : null,
    durationMs: toolCall.durationMs ?? null,
  };
}

function serializeProjectRunDetailsApproval(
  approval: ToolApproval,
): ProjectRunDetailsApproval {
  const riskCategories = Array.isArray(approval.riskCategories)
    ? approval.riskCategories.filter(
        (category): category is string => typeof category === "string",
      )
    : [];

  return {
    toolCallId: approval.toolCallId,
    decision: approval.decision,
    title: redactText(approval.title),
    summary: redactText(approval.summary),
    riskCategories,
    requestedAt: approval.requestedAt.getTime(),
    respondedAt: approval.respondedAt?.getTime() ?? null,
  };
}

function serializeProjectRunDetailsContext(
  context: RunContextSummary | undefined,
): ProjectRunDetailsContext {
  if (!context) return null;

  const facts = stringArray(context.facts).map(redactText);
  const files = fileArray(context.files);
  const commands = commandArray(context.commands);
  const tools = toolArray(context.tools);

  return {
    summary: redactText(context.summary),
    facts,
    files,
    commands,
    tools,
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function fileArray(value: unknown): ProjectRunDetailsContextFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const path = stringValue(item.path);
    const action = stringValue(item.action);
    return path && action ? [{ path, action }] : [];
  });
}

function commandArray(value: unknown): ProjectRunDetailsContextCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const command = stringValue(item.command);
    if (!command) return [];
    return [
      {
        command: redactText(command),
        exitCode:
          typeof item.exitCode === "number" && Number.isInteger(item.exitCode)
            ? item.exitCode
            : null,
        ok: item.ok === true,
        timedOut: item.timedOut === true,
        ...(stringValue(item.error)
          ? { error: redactText(stringValue(item.error) as string) }
          : {}),
      },
    ];
  });
}

function toolArray(value: unknown): ProjectRunDetailsContextTool[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = stringValue(item.name);
    if (!name) return [];
    const status = item.status === "error" ? "error" : "completed";
    return [
      {
        name,
        status,
        ...(stringValue(item.input)
          ? { input: redactText(stringValue(item.input) as string) }
          : {}),
        ...(stringValue(item.output)
          ? { output: redactText(stringValue(item.output) as string) }
          : {}),
        ...(typeof item.exitCode === "number" && Number.isInteger(item.exitCode)
          ? { exitCode: item.exitCode }
          : {}),
        ...(stringValue(item.error)
          ? { error: redactText(stringValue(item.error) as string) }
          : {}),
      },
    ];
  });
}

function derivePermissionLabel(
  toolName: string,
  approval: ToolApproval | undefined,
): string | null {
  const approvalCategories = Array.isArray(approval?.riskCategories)
    ? approval.riskCategories.filter(
        (category): category is string => typeof category === "string",
      )
    : [];
  const permissionFromApproval = approvalCategories.find(isToolRiskCategory);
  if (permissionFromApproval) return permissionFromApproval;

  const native = getNativeToolPermissionMetadata(toolName);
  return native?.categories[0] ?? null;
}

function isToolRiskCategory(value: string): value is ToolRiskCategory {
  return (TOOL_RISK_CATEGORIES as readonly string[]).includes(value);
}

function contextCompositionFromTokenAudit(
  tokenAudit: Record<string, unknown> | null,
): ProjectRunDetailsContextComposition | undefined {
  if (!tokenAudit) return undefined;
  const composition = isRecord(tokenAudit.contextComposition)
    ? tokenAudit.contextComposition
    : undefined;
  if (!composition) return undefined;

  const sections = {
    systemPromptTokens: finiteNumber(composition.systemPromptTokens),
    toolDefinitionsTokens: finiteNumber(composition.toolDefinitionsTokens),
    memoryTokens: finiteNumber(composition.memoryTokens),
    skillsTokens: finiteNumber(composition.skillsTokens),
    mcpPromptTokens: finiteNumber(composition.mcpPromptTokens),
    runProfileTokens: finiteNumber(composition.runProfileTokens),
    priorRunContextTokens: finiteNumber(composition.priorRunContextTokens),
    conversationTokens: finiteNumber(composition.conversationTokens),
  };

  if (
    Object.values(sections).every(
      (value) => value === undefined || value === 0,
    )
  ) {
    return undefined;
  }

  return {
    systemPromptTokens: sections.systemPromptTokens ?? 0,
    toolDefinitionsTokens: sections.toolDefinitionsTokens ?? 0,
    memoryTokens: sections.memoryTokens ?? 0,
    skillsTokens: sections.skillsTokens ?? 0,
    mcpPromptTokens: sections.mcpPromptTokens ?? 0,
    runProfileTokens: sections.runProfileTokens ?? 0,
    priorRunContextTokens: sections.priorRunContextTokens ?? 0,
    conversationTokens: sections.conversationTokens ?? 0,
    source: "estimated",
  };
}

function stepUsageFromTokenAudit(
  tokenAudit: Record<string, unknown> | null,
): ProjectRunDetailsStepUsage[] {
  if (!tokenAudit || !Array.isArray(tokenAudit.steps)) return [];

  return tokenAudit.steps.flatMap((step): ProjectRunDetailsStepUsage[] => {
    if (!isRecord(step)) return [];
    const stepNumber = finiteNumber(step.stepNumber);
    if (stepNumber === undefined) return [];
    return [
      {
        stepNumber,
        ...(finiteNumber(step.inputTokens) !== undefined
          ? { inputTokens: finiteNumber(step.inputTokens) }
          : {}),
        ...(finiteNumber(step.outputTokens) !== undefined
          ? { outputTokens: finiteNumber(step.outputTokens) }
          : {}),
        ...(finiteNumber(step.reasoningTokens) !== undefined
          ? { reasoningTokens: finiteNumber(step.reasoningTokens) }
          : {}),
        ...(finiteNumber(step.cachedInputTokens) !== undefined
          ? { cachedInputTokens: finiteNumber(step.cachedInputTokens) }
          : {}),
        ...(finiteNumber(step.toolCallCount) !== undefined
          ? { toolCallCount: finiteNumber(step.toolCallCount) }
          : {}),
        ...(typeof step.finishReason === "string"
          ? { finishReason: step.finishReason }
          : {}),
      },
    ];
  });
}

function promptCacheFromTokenAudit(
  tokenAudit: Record<string, unknown> | null,
): ProjectRunDetailsPromptCache | undefined {
  if (!tokenAudit || !isRecord(tokenAudit.promptCache)) return undefined;
  const cache = tokenAudit.promptCache;
  const modelId = stringValue(cache.modelId);
  const providerId = stringValue(cache.providerId);
  if (!modelId || !providerId) return undefined;
  const likelyCacheMissReasons = Array.isArray(cache.likelyCacheMissReasons)
    ? cache.likelyCacheMissReasons.flatMap((reason) =>
        typeof reason === "string" ? [reason] : [],
      )
    : [];
  return {
    modelId,
    providerId,
    systemPromptHash: stringValue(cache.systemPromptHash) ?? "—",
    toolSchemaHash: stringValue(cache.toolSchemaHash) ?? "—",
    nativeToolNamesHash: stringValue(cache.nativeToolNamesHash) ?? "—",
    mcpToolNamesHash: stringValue(cache.mcpToolNamesHash) ?? "—",
    workspaceContextHash: stringValue(cache.workspaceContextHash) ?? "—",
    messagePrefixHash: stringValue(cache.messagePrefixHash) ?? "—",
    ...(finiteNumber(cache.cachedInputTokens) !== undefined
      ? { cachedInputTokens: finiteNumber(cache.cachedInputTokens) }
      : {}),
    ...(finiteNumber(cache.cacheWriteTokens) !== undefined
      ? { cacheWriteTokens: finiteNumber(cache.cacheWriteTokens) }
      : {}),
    ...(finiteNumber(cache.cacheHitRate) !== undefined
      ? { cacheHitRate: finiteNumber(cache.cacheHitRate) }
      : {}),
    likelyCacheMissReasons,
    cacheBreakReasons: stringArray(cache.cacheBreakReasons),
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
