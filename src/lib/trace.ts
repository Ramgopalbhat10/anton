import {
  getToolName,
  isDataUIPart,
  isReasoningUIPart,
  isToolUIPart,
  type UIMessage,
  type UITools,
} from "ai";

export type AntonRunStatus = "running" | "completed" | "error" | "aborted";

export type AntonActivityKind =
  | "step"
  | "reasoning"
  | "tool"
  | "approval"
  | "error"
  | "progress";

export type AntonActivityStatus =
  | "running"
  | "completed"
  | "waiting"
  | "error"
  | "denied";

export type AntonMessageMetadata = {
  runId?: string;
  responseKind?: "plan";
  model?: string;
  status?: AntonRunStatus;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  costMetadata?: Record<string, unknown> | null;
  stepCount?: number;
  finishReason?: string;
  maxSteps?: number;
  maxStepLimitReached?: boolean;
  maxCostUsd?: number;
  costBudgetReached?: boolean;
  profileHandoffRequired?: boolean;
  handoffFromProfile?: "localized-edit" | "single-file-edit";
  handoffToProfile?: "general-chat";
  handoffReason?: string;
};

export type AntonRunData = {
  runId: string;
  model: string;
  status: AntonRunStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  rawTotalTokens?: number;
  effectiveTokens?: number;
  costUsd?: number;
  costMetadata?: Record<string, unknown> | null;
  stepCount?: number;
  finishReason?: string;
  maxSteps?: number;
  maxStepLimitReached?: boolean;
  maxCostUsd?: number;
  costBudgetReached?: boolean;
  profile?: string;
  mode?: string;
  tokenBudgetMultiplier?: number;
  cacheHitRate?: number;
  loopGuardCount?: number;
  verificationSummary?: string;
  promotionReason?: string;
  effectiveProfile?: string;
  profileHandoffRequired?: boolean;
  handoffFromProfile?: "localized-edit" | "single-file-edit";
  handoffToProfile?: "general-chat";
  handoffReason?: string;
  hadSuccessfulEdit?: boolean;
};

export type AntonRunMetricSnapshot = {
  id: string;
  model?: string | null;
  status?: AntonRunStatus | null;
  startedAt?: Date | number | null;
  finishedAt?: Date | number | null;
  durationMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  costMetadata?: unknown;
  stepCount?: number | null;
  finishReason?: string | null;
  maxCostUsd?: number | null;
  costBudgetReached?: boolean | null;
};

export type AntonActivitySnapshot = {
  id: string;
  runId: string;
  sequence: number;
  kind: AntonActivityKind;
  status: AntonActivityStatus;
  label: string;
  summary?: string | null;
  startedAt: Date | number;
  finishedAt?: Date | number | null;
  durationMs?: number | null;
  toolCallId?: string | null;
  details?: unknown;
};

export type AntonActivityEvent = {
  id: string;
  runId: string;
  sequence: number;
  kind: AntonActivityKind;
  status: AntonActivityStatus;
  label: string;
  summary?: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  toolCallId?: string;
  details?: Record<string, unknown>;
};

export type AntonTodoStatus = "pending" | "in_progress" | "completed";

export type AntonTodoItem = {
  id: string;
  text: string;
  status: AntonTodoStatus;
};

export type AntonTodoSnapshot = {
  runId: string;
  items: AntonTodoItem[];
  updatedAt: number;
};

export type AntonDataParts = {
  run: AntonRunData;
  activity: AntonActivityEvent;
  todos: AntonTodoSnapshot;
};

export type AntonUIMessage = UIMessage<
  AntonMessageMetadata,
  AntonDataParts,
  UITools
>;

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

export type ToolTraceEntry = {
  id: string;
  sourceMessageId: string;
  name: string;
  state: ToolState;
  input: unknown;
  output: unknown;
  errorText: string | undefined;
  approvalId: string | undefined;
  activity?: AntonActivityEvent;
};

export type AntonToolCallStateSnapshot = {
  toolCallId: string;
  status: "running" | "completed" | "error" | "denied";
  approvalDecision?: "pending" | "approved" | "denied" | null;
};

export type ApprovalMetadata = {
  title: string;
  summary: string;
  riskCategories: string[];
  riskSummary: string;
  details: string[];
  target?: string;
  diffPreview?: {
    path: string;
    previous: string;
    next: string;
    truncated: boolean;
  };
  command?: {
    command: string;
    commandPolicyMode?: "enforced" | "advisory";
    shell: string;
    cwd: string;
    timeoutMs: number;
    outputCapBytes: number;
    classification: {
      categories: string[];
      forbidden: boolean;
      reason: string;
    };
  };
  external?: {
    serverName: string;
    toolName: string;
    sandboxedByAnton: boolean;
  };
  bashClassification?: {
    categories: string[];
    forbidden: boolean;
    reason: string;
    commandPolicyMode?: "enforced" | "advisory";
  };
};

export function getApprovalMetadata(
  entry: ToolTraceEntry,
): ApprovalMetadata | undefined {
  const details = entry.activity?.details;
  if (!details) return approvalMetadataFromToolInput(entry);
  const structured = structuredApprovalMetadata(details.approval);
  if (structured) return structured;

  const riskCategories = stringArray(details.riskCategories);
  const riskSummary = details.riskSummary;
  if (
    riskCategories.length === 0 ||
    typeof riskSummary !== "string"
  ) {
    return undefined;
  }
  const bashDetails = details.bashClassification;
  let bashClassification: ApprovalMetadata["bashClassification"] | undefined;
  if (
    typeof bashDetails === "object" &&
    bashDetails !== null &&
    typeof (bashDetails as Record<string, unknown>).reason === "string"
  ) {
    const categories = stringArray(
      (bashDetails as Record<string, unknown>).categories,
    );
    bashClassification = {
      categories,
      forbidden: Boolean((bashDetails as Record<string, unknown>).forbidden),
      reason: (bashDetails as Record<string, unknown>).reason as string,
      commandPolicyMode: commandPolicyModeValue(
        (bashDetails as Record<string, unknown>).commandPolicyMode,
      ),
    };
  }
  return {
    title: entry.name,
    summary: riskSummary,
    riskCategories:
      entry.name === "bash" && bashClassification?.categories.length
        ? bashClassification.categories
        : riskCategories,
    riskSummary,
    details:
      bashClassification && !bashClassification.forbidden
        ? [riskSummary, bashClassification.reason]
        : [riskSummary],
    bashClassification,
  };
}

export type AssistantTextDisplay = {
  progressText: string;
  finalText: string;
};

const LEAKED_MARKUP_BLOCK =
  /<\|DSML\|[^>]*>[\s\S]*?<\/\|DSML\|[^>]*>/gi;
const LEAKED_MARKUP_TAG =
  /<\|(?:DSML|tool_call|tool_calls|function_call|invoke)[^|]*\|[^>]*>/gi;

const PLAN_REASONING_MARKER =
  /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:implementation\s+)?plan\s*:?\s*(?:\*\*)?\s*$/i;

export function stripLeakedProviderMarkup(text: string): string {
  let next = text.replace(LEAKED_MARKUP_BLOCK, "");
  next = next.replace(LEAKED_MARKUP_TAG, "");
  next = next.replace(/<\|DSML\|[^>]*>[\s\S]*$/gi, "");
  return next.trim();
}

export function getAssistantTextDisplay(
  message: AntonUIMessage,
  options: { progressOnly?: boolean } = {},
): AssistantTextDisplay {
  const lastToolIndex = message.parts.findLastIndex(isToolUIPart);
  const progressText: string[] = [];
  const finalText: string[] = [];
  const trailingPlanReasoningText: string[] = [];
  const usePlanReasoningFallback = message.metadata?.responseKind === "plan";

  for (const [index, part] of message.parts.entries()) {
    if (part.type === "reasoning") {
      const text = stripLeakedProviderMarkup(part.text);
      if (text && usePlanReasoningFallback && index > lastToolIndex) {
        trailingPlanReasoningText.push(text);
      }
      continue;
    }

    if (part.type === "text") {
      const text = stripLeakedProviderMarkup(part.text);
      if (!text) continue;
      if (options.progressOnly || (lastToolIndex !== -1 && index < lastToolIndex)) {
        progressText.push(text);
      } else {
        finalText.push(text);
      }
    }
  }

  if (finalText.length === 0 && trailingPlanReasoningText.length > 0) {
    const planFallback = extractPlanReasoningFallback(
      trailingPlanReasoningText.join("\n\n"),
    );
    if (planFallback) finalText.push(planFallback);
  }

  return {
    progressText: progressText.join("\n\n"),
    finalText: finalText.join("\n\n"),
  };
}

function extractPlanReasoningFallback(text: string): string | undefined {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const markerIndex = lines.findIndex((line) =>
    PLAN_REASONING_MARKER.test(line),
  );
  if (markerIndex === -1) return undefined;
  const planText = lines.slice(markerIndex + 1).join("\n").trim();
  return planText || undefined;
}

export function hasPendingToolApproval(message: AntonUIMessage): boolean {
  return getToolTraceEntries([message]).some(
    (entry) => entry.state === "approval-requested",
  );
}

export function hasFailedToolOutput(message: AntonUIMessage): boolean {
  return getToolTraceEntries([message]).some((entry) => {
    return entry.state === "output-error" || isFailedToolOutput(entry.output);
  });
}

export function failedToolOutputMessage(output: unknown): string | undefined {
  if (!isRecord(output)) return undefined;
  const message = output.message;
  if (typeof message === "string" && message.trim().length > 0) return message.trim();
  const error = output.error;
  if (typeof error === "string" && error.trim().length > 0) return error.trim();
  const failedReason = output.failedReason;
  if (typeof failedReason === "string" && failedReason.trim().length > 0) {
    return failedReason.trim();
  }
  const exitCode = output.exitCode;
  if (typeof exitCode === "number" && exitCode !== 0) {
    return `Command exited with code ${exitCode}.`;
  }
  return undefined;
}

const STATE_CHANGING_TOOL_NAMES = new Set([
  "edit_file",
  "edit_text",
  "replace_text",
  "replace_lines",
  "multi_replace_text",
  "write_file",
]);

export function messageHadSuccessfulStateChangingEdit(
  message: AntonUIMessage,
): boolean {
  return getToolTraceEntries([message]).some((entry) => {
    if (entry.state !== "output-available") return false;
    if (!STATE_CHANGING_TOOL_NAMES.has(entry.name)) return false;
    return isRecord(entry.output) && entry.output.ok === true;
  });
}

export function messageIsLoopGuardIncomplete(message: AntonUIMessage): boolean {
  return getRunDataList(message).some(
    (run) => run.finishReason === "loop_guard_incomplete",
  );
}

export function messageIsUnverifiedEdit(message: AntonUIMessage): boolean {
  return getRunDataList(message).some(
    (run) => run.finishReason === "unverified_edit",
  );
}

export function messageIsVerificationFailed(message: AntonUIMessage): boolean {
  return getRunDataList(message).some(
    (run) => run.finishReason === "verification_failed",
  );
}

function isFailedToolOutput(output: unknown): boolean {
  if (!isRecord(output)) return false;
  if (output.ok === false) return true;
  if (output.timedOut === true) return true;
  if (
    typeof output.failedReason === "string" &&
    output.failedReason.length > 0
  ) {
    return true;
  }
  const exitCode = output.exitCode;
  return typeof exitCode === "number" && exitCode !== 0;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structuredApprovalMetadata(value: unknown): ApprovalMetadata | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const title = record.title;
  const summary = record.summary;
  const riskCategories = stringArray(record.riskCategories);
  const details = stringArray(record.details);

  if (
    typeof title !== "string" ||
    typeof summary !== "string" ||
    riskCategories.length === 0
  ) {
    return undefined;
  }

  const command = structuredCommandMetadata(record.command);
  return {
    title,
    summary,
    riskCategories:
      command?.classification.categories.length
        ? command.classification.categories
        : riskCategories,
    riskSummary: summary,
    details: details.length > 0 ? details : [summary],
    target:
      typeof record.target === "string" ? record.target : undefined,
    diffPreview: structuredDiffPreview(record.diffPreview),
    command,
    external: structuredExternalMetadata(record.external),
    bashClassification: command
      ? {
          ...command.classification,
          commandPolicyMode: command.commandPolicyMode,
        }
      : undefined,
  };
}

function structuredDiffPreview(
  value: unknown,
): ApprovalMetadata["diffPreview"] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.path !== "string" ||
    typeof record.previous !== "string" ||
    typeof record.next !== "string" ||
    typeof record.truncated !== "boolean"
  ) {
    return undefined;
  }
  return {
    path: record.path,
    previous: record.previous,
    next: record.next,
    truncated: record.truncated,
  };
}

function approvalMetadataFromToolInput(
  entry: ToolTraceEntry,
): ApprovalMetadata | undefined {
  if (entry.name === "edit_file") {
    const input = isRecord(entry.input) ? entry.input : {};
    const path = typeof input.path === "string" ? input.path : undefined;
    const patch = typeof input.patch === "string" ? input.patch : undefined;
    const expectedHash =
      typeof input.expectedHash === "string" ? input.expectedHash : undefined;
    const diffPreview =
      path && patch ? diffPreviewFromUnifiedPatch(path, patch) : undefined;

    return {
      title: "Patch workspace file",
      summary: "Applies a patch to an existing workspace file.",
      riskCategories: ["write"],
      riskSummary: "Applies a patch to an existing workspace file.",
      target: path,
      details: [
        path ? `Path: ${path}` : "Path: (missing)",
        "Applies one single-file unified diff to an existing UTF-8 file.",
        "The patch is applied with zero fuzz; context must match exactly.",
        `Expected hash: ${expectedHash ?? "(missing)"}.`,
      ],
      diffPreview,
    };
  }

  return undefined;
}

function diffPreviewFromUnifiedPatch(
  path: string,
  patch: string,
): ApprovalMetadata["diffPreview"] | undefined {
  const previous: string[] = [];
  const next: string[] = [];
  let inHunk = false;

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@ ")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+")) {
      next.push(line.slice(1));
    } else if (line.startsWith("-")) {
      previous.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      const content = line.slice(1);
      previous.push(content);
      next.push(content);
    } else if (line === "") {
      previous.push("");
      next.push("");
    }
  }

  if (previous.length === 0 && next.length === 0) return undefined;
  return {
    path,
    previous: previous.join("\n"),
    next: next.join("\n"),
    truncated: false,
  };
}

function structuredCommandMetadata(
  value: unknown,
): ApprovalMetadata["command"] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const classification = structuredClassification(record.classification);
  if (
    typeof record.command !== "string" ||
    typeof record.shell !== "string" ||
    typeof record.cwd !== "string" ||
    typeof record.timeoutMs !== "number" ||
    typeof record.outputCapBytes !== "number" ||
    !classification
  ) {
    return undefined;
  }
  return {
    command: record.command,
    commandPolicyMode: commandPolicyModeValue(record.commandPolicyMode),
    shell: record.shell,
    cwd: record.cwd,
    timeoutMs: record.timeoutMs,
    outputCapBytes: record.outputCapBytes,
    classification,
  };
}

function structuredClassification(
  value: unknown,
): NonNullable<ApprovalMetadata["command"]>["classification"] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.reason !== "string") return undefined;
  return {
    categories: stringArray(record.categories),
    forbidden: Boolean(record.forbidden),
    reason: record.reason,
  };
}

function commandPolicyModeValue(
  value: unknown,
): "enforced" | "advisory" | undefined {
  return value === "enforced" || value === "advisory" ? value : undefined;
}

function structuredExternalMetadata(
  value: unknown,
): ApprovalMetadata["external"] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.serverName !== "string" ||
    typeof record.toolName !== "string" ||
    typeof record.sandboxedByAnton !== "boolean"
  ) {
    return undefined;
  }
  return {
    serverName: record.serverName,
    toolName: record.toolName,
    sandboxedByAnton: record.sandboxedByAnton,
  };
}

export function getRunData(message: AntonUIMessage): AntonRunData | undefined {
  let run: AntonRunData | undefined;
  for (const part of message.parts) {
    if (isRunDataPart(part)) run = part.data;
  }
  return run;
}

export function getRunDataList(message: AntonUIMessage): AntonRunData[] {
  const byRunId = new Map<string, AntonRunData>();
  for (const part of message.parts) {
    if (isRunDataPart(part)) byRunId.set(part.data.runId, part.data);
  }
  return Array.from(byRunId.values());
}

export function hydrateMessagesWithRunMetrics<UI extends AntonUIMessage>(
  messages: UI[],
  runs: AntonRunMetricSnapshot[],
): UI[] {
  const runsById = new Map(runs.map((run) => [run.id, run]));
  if (runsById.size === 0) return messages;

  return messages.map((message) => {
    const metadata = hydrateMetricRecord(message.metadata, runsById);
    let partsChanged = false;
    const parts = message.parts.map((part) => {
      if (!isRunDataPart(part)) return part;
      const data = hydrateMetricRecord(part.data, runsById);
      if (data !== part.data) partsChanged = true;
      return data === part.data ? part : { ...part, data };
    }) as UI["parts"];

    return metadata === message.metadata && !partsChanged
      ? message
      : {
          ...message,
          metadata: metadata as UI["metadata"],
          parts,
      };
  });
}

export function hydrateMessagesWithRunState<UI extends AntonUIMessage>(
  messages: UI[],
  runs: AntonRunMetricSnapshot[],
  events: AntonActivitySnapshot[],
): UI[] {
  const metricsHydrated = hydrateMessagesWithRunMetrics(messages, runs);
  const runsById = new Map(runs.map((run) => [run.id, run]));
  if (runsById.size === 0) return metricsHydrated;
  const referencedRunIds = new Set(messages.flatMap(messageRunIds));
  const orphanRunIds = Array.from(runsById.keys()).filter(
    (runId) => !referencedRunIds.has(runId),
  );
  const orphanTargetMessageId = messages.findLast(
    (candidate) => candidate.role === "assistant",
  )?.id;

  const eventsByRunId = new Map<string, AntonActivitySnapshot[]>();
  for (const event of events) {
    const runEvents = eventsByRunId.get(event.runId) ?? [];
    runEvents.push(event);
    eventsByRunId.set(event.runId, runEvents);
  }
  for (const runEvents of eventsByRunId.values()) {
    runEvents.sort((a, b) => a.sequence - b.sequence);
  }

  return metricsHydrated.map((message) => {
    const runIds = [
      ...(message.id === orphanTargetMessageId ? orphanRunIds : []),
      ...messageRunIds(message),
    ];
    if (runIds.length === 0) return message;

    const durableRunParts = runIds
      .map((runId) => runsById.get(runId))
      .filter((run): run is AntonRunMetricSnapshot => run !== undefined)
      .map((run) => ({
        type: "data-run",
        id: run.id,
        data: runDataFromSnapshot(run),
      }));

    const durableActivityParts = runIds.flatMap((runId) =>
      (eventsByRunId.get(runId) ?? []).map((event) => ({
        type: "data-activity",
        id: event.id,
        data: activityDataFromSnapshot(event),
      })),
    );

    if (durableRunParts.length === 0 && durableActivityParts.length === 0) {
      return message;
    }

    return {
      ...message,
      parts: [
        ...message.parts.filter(
          (part) => !isRunDataPart(part) && !isActivityDataPart(part),
        ),
        ...durableRunParts,
        ...durableActivityParts,
      ] as UI["parts"],
    };
  });
}

export function collapseAssistantContinuationMessages<UI extends AntonUIMessage>(
  messages: UI[],
): UI[] {
  const collapsed: UI[] = [];

  for (const message of messages) {
    const previous = collapsed.at(-1);
    if (
      previous?.role === "assistant" &&
      message.role === "assistant" &&
      assistantMessageContainsPrefix(previous, message)
    ) {
      collapsed[collapsed.length - 1] = message;
      continue;
    }
    collapsed.push(message);
  }

  return collapsed.length === messages.length ? messages : collapsed;
}

export function assistantMessageContainsPrefix(
  previous: AntonUIMessage,
  next: AntonUIMessage,
): boolean {
  const previousParts = nonDurablePartSignatures(previous);
  const nextParts = nonDurablePartSignatures(next);
  if (previousParts.length === 0 || previousParts.length >= nextParts.length) {
    return false;
  }

  return previousParts.every((signature, index) => {
    return signature === nextParts[index];
  });
}

export function hydrateMessagesWithToolCallState<UI extends AntonUIMessage>(
  messages: UI[],
  toolCallStates: AntonToolCallStateSnapshot[],
): UI[] {
  const effectiveStates = effectiveStatesByToolCallId(toolCallStates);
  if (effectiveStates.size === 0) return messages;

  return messages.map((message) => {
    let changed = false;
    const parts = message.parts.map((part) => {
      if (!isToolUIPart(part)) return part;
      const toolCallId =
        "toolCallId" in part && typeof part.toolCallId === "string"
          ? part.toolCallId
          : undefined;
      if (!toolCallId) return part;
      const state = effectiveStates.get(toolCallId);
      if (!state || !("state" in part) || part.state === state) return part;
      changed = true;
      return { ...part, state };
    }) as UI["parts"];

    return changed ? { ...message, parts } : message;
  });
}

function effectiveStatesByToolCallId(
  toolCallStates: AntonToolCallStateSnapshot[],
): Map<string, ToolState> {
  const byToolCallId = new Map<
    string,
    {
      completed: boolean;
      error: boolean;
      denied: boolean;
      approved: boolean;
    }
  >();

  for (const toolCall of toolCallStates) {
    const current = byToolCallId.get(toolCall.toolCallId) ?? {
      completed: false,
      error: false,
      denied: false,
      approved: false,
    };
    current.completed ||= toolCall.status === "completed";
    current.error ||= toolCall.status === "error";
    current.denied ||=
      toolCall.status === "denied" || toolCall.approvalDecision === "denied";
    current.approved ||=
      toolCall.approvalDecision === "approved" || toolCall.status === "completed";
    byToolCallId.set(toolCall.toolCallId, current);
  }

  const effectiveStates = new Map<string, ToolState>();
  for (const [toolCallId, state] of byToolCallId.entries()) {
    if (state.completed) {
      effectiveStates.set(toolCallId, "output-available");
    } else if (state.error) {
      effectiveStates.set(toolCallId, "output-error");
    } else if (state.denied) {
      effectiveStates.set(toolCallId, "output-denied");
    } else if (state.approved) {
      effectiveStates.set(toolCallId, "approval-responded");
    }
  }
  return effectiveStates;
}

function hydrateMetricRecord<T>(
  value: T,
  runsById: Map<string, AntonRunMetricSnapshot>,
): T {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const runId = record.runId;
  if (typeof runId !== "string") return value;
  const run = runsById.get(runId);
  if (!run) return value;

  let next: Record<string, unknown> | undefined;
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "costUsd"] as const) {
    const metric = run[key];
    if (typeof metric !== "number" || !Number.isFinite(metric)) continue;
    if (record[key] === metric) continue;
    next ??= { ...record };
    next[key] = metric;
  }
  for (const key of ["durationMs", "stepCount", "maxCostUsd"] as const) {
    const metric = run[key];
    if (typeof metric !== "number" || !Number.isFinite(metric)) continue;
    if (record[key] === metric) continue;
    next ??= { ...record };
    next[key] = metric;
  }
  if (typeof run.model === "string" && record.model !== run.model) {
    next ??= { ...record };
    next.model = run.model;
  }
  if (run.status && record.status !== run.status) {
    next ??= { ...record };
    next.status = run.status;
  }
  const startedAt = toMillis(run.startedAt);
  if (startedAt !== undefined && record.startedAt !== startedAt) {
    next ??= { ...record };
    next.startedAt = startedAt;
  }
  const finishedAt = toMillis(run.finishedAt);
  if (finishedAt !== undefined && record.finishedAt !== finishedAt) {
    next ??= { ...record };
    next.finishedAt = finishedAt;
  }
  if (typeof run.finishReason === "string" && record.finishReason !== run.finishReason) {
    next ??= { ...record };
    next.finishReason = run.finishReason;
  }
  if (run.finishReason === "max_step_limit" && record.maxStepLimitReached !== true) {
    next ??= { ...record };
    next.maxStepLimitReached = true;
  }
  if (run.finishReason === "cost_budget_limit" && record.costBudgetReached !== true) {
    next ??= { ...record };
    next.costBudgetReached = true;
  }
  if (run.finishReason === "profile_handoff_required") {
    if (record.profileHandoffRequired !== true) {
      next ??= { ...record };
      next.profileHandoffRequired = true;
    }
    const handoff = profileHandoffDataFromMetadata(run.costMetadata);
    for (const [key, value] of Object.entries(handoff)) {
      if (record[key] === value) continue;
      next ??= { ...record };
      next[key] = value;
    }
  }

  return (next ?? value) as T;
}

function messageRunIds(message: AntonUIMessage): string[] {
  const ids = new Set<string>();
  const metadataRunId = message.metadata?.runId;
  if (typeof metadataRunId === "string") ids.add(metadataRunId);
  for (const part of message.parts) {
    if (isRunDataPart(part)) ids.add(part.data.runId);
  }
  return Array.from(ids);
}

function nonDurablePartSignatures(message: AntonUIMessage): string[] {
  return message.parts
    .filter((part) => !isRunDataPart(part) && !isActivityDataPart(part))
    .map(stablePartSignature);
}

function stablePartSignature(part: AntonUIMessage["parts"][number]): string {
  const record = part as Record<string, unknown>;
  const signature: Record<string, unknown> = { type: part.type };

  if (part.type === "text" || part.type === "reasoning") {
    signature.text = part.text;
  }
  if ("toolCallId" in part && typeof part.toolCallId === "string") {
    signature.toolCallId = part.toolCallId;
  } else if ("state" in part && typeof part.state === "string") {
    signature.state = part.state;
  }
  if (isTodosDataPart(part)) {
    signature.id = part.id;
    signature.runId = part.data.runId;
    signature.updatedAt = part.data.updatedAt;
    signature.items = part.data.items.map((item) => [
      item.id,
      item.text,
      item.status,
    ]);
  }
  if (part.type !== "text" && part.type !== "reasoning" && !isTodosDataPart(part)) {
    signature.id = typeof record.id === "string" ? record.id : undefined;
  }

  return JSON.stringify(signature);
}

function runDataFromSnapshot(run: AntonRunMetricSnapshot): AntonRunData {
  return {
    runId: run.id,
    model: run.model ?? "unknown",
    status: run.status ?? "completed",
    startedAt: toMillis(run.startedAt) ?? 0,
    ...(toMillis(run.finishedAt) !== undefined
      ? { finishedAt: toMillis(run.finishedAt) }
      : {}),
    ...(typeof run.durationMs === "number" ? { durationMs: run.durationMs } : {}),
    ...(typeof run.inputTokens === "number" ? { inputTokens: run.inputTokens } : {}),
    ...(typeof run.outputTokens === "number" ? { outputTokens: run.outputTokens } : {}),
    ...(typeof run.totalTokens === "number" ? { totalTokens: run.totalTokens } : {}),
    ...(typeof run.costUsd === "number" ? { costUsd: run.costUsd } : {}),
    ...(isRecord(run.costMetadata) ? { costMetadata: run.costMetadata } : {}),
    ...(typeof run.stepCount === "number" ? { stepCount: run.stepCount } : {}),
    ...(typeof run.finishReason === "string" ? { finishReason: run.finishReason } : {}),
    ...costBudgetDataFromMetadata(run.costMetadata),
    ...(run.finishReason === "max_step_limit"
      ? { maxStepLimitReached: true }
      : {}),
    ...(run.finishReason === "cost_budget_limit"
      ? { costBudgetReached: true }
      : {}),
    ...(run.finishReason === "profile_handoff_required"
      ? { profileHandoffRequired: true }
      : {}),
    ...profileHandoffDataFromMetadata(run.costMetadata),
  };
}

function profileHandoffDataFromMetadata(
  costMetadata: unknown,
): Pick<
  AntonRunData,
  | "profileHandoffRequired"
  | "handoffFromProfile"
  | "handoffToProfile"
  | "handoffReason"
> {
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

function costBudgetDataFromMetadata(
  costMetadata: unknown,
): Pick<AntonRunData, "maxCostUsd" | "costBudgetReached"> {
  if (!isRecord(costMetadata)) return {};
  const costBudget = isRecord(costMetadata.costBudget)
    ? costMetadata.costBudget
    : undefined;
  if (!costBudget) return {};
  const maxCostUsd = costBudget.maxCostUsd;
  const reached = costBudget.reached;
  return {
    ...(typeof maxCostUsd === "number" && Number.isFinite(maxCostUsd)
      ? { maxCostUsd }
      : {}),
    ...(typeof reached === "boolean" ? { costBudgetReached: reached } : {}),
  };
}

function activityDataFromSnapshot(event: AntonActivitySnapshot): AntonActivityEvent {
  return {
    id: event.id,
    runId: event.runId,
    sequence: event.sequence,
    kind: event.kind,
    status: event.status,
    label: event.label,
    ...(event.summary ? { summary: event.summary } : {}),
    startedAt: toMillis(event.startedAt) ?? 0,
    ...(toMillis(event.finishedAt) !== undefined
      ? { finishedAt: toMillis(event.finishedAt) }
      : {}),
    ...(typeof event.durationMs === "number" ? { durationMs: event.durationMs } : {}),
    ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
    ...(isRecord(event.details) ? { details: event.details } : {}),
  };
}

function toMillis(value: Date | number | null | undefined): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

export function getMessageRunDurationMs(
  message: AntonUIMessage,
  now = Date.now(),
): number | undefined {
  const runs = getRunDataList(message);
  if (runs.length > 0) return sumRunDurations(runs, now);

  const metadataDuration = finiteNumber(message.metadata?.durationMs);
  if (metadataDuration !== undefined) return metadataDuration;

  const startedAt = finiteNumber(message.metadata?.startedAt);
  if (message.metadata?.status === "running" && startedAt !== undefined) {
    return Math.max(0, now - startedAt);
  }

  const finishedAt = finiteNumber(message.metadata?.finishedAt);
  if (startedAt !== undefined && finishedAt !== undefined) {
    return Math.max(0, finishedAt - startedAt);
  }

  return undefined;
}

function sumRunDurations(runs: AntonRunData[], now: number): number | undefined {
  let total = 0;
  let hasDuration = false;

  for (const run of runs) {
    const duration = runDurationMs(run, now);
    if (duration === undefined) continue;
    total += duration;
    hasDuration = true;
  }

  return hasDuration ? total : undefined;
}

function runDurationMs(run: AntonRunData, now: number): number | undefined {
  const durationMs = finiteNumber(run.durationMs);
  if (durationMs !== undefined) return durationMs;

  const startedAt = finiteNumber(run.startedAt);
  if (run.status === "running" && startedAt !== undefined) {
    return Math.max(0, now - startedAt);
  }

  const finishedAt = finiteNumber(run.finishedAt);
  if (startedAt !== undefined && finishedAt !== undefined) {
    return Math.max(0, finishedAt - startedAt);
  }

  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function getActivityEvents(
  message: AntonUIMessage,
): AntonActivityEvent[] {
  const byId = new Map<string, AntonActivityEvent>();
  for (const part of message.parts) {
    if (isActivityDataPart(part)) byId.set(part.data.id, part.data);
  }
  return Array.from(byId.values()).sort((a, b) => a.sequence - b.sequence);
}

export function getToolTraceEntries(
  messages: AntonUIMessage[],
): ToolTraceEntry[] {
  const entriesById = new Map<string, ToolTraceEntry>();
  for (const message of messages) {
    const activityByToolCallId = new Map<string, AntonActivityEvent>();
    for (const activity of getActivityEvents(message)) {
      if (activity.kind === "tool" && activity.toolCallId) {
        activityByToolCallId.set(activity.toolCallId, activity);
      }
    }

    message.parts.forEach((part, index) => {
      if (!isToolUIPart(part)) return;
      const state = part.state as ToolState;
      const toolCallId =
        "toolCallId" in part && typeof part.toolCallId === "string"
          ? part.toolCallId
          : undefined;
      const id = toolCallId ?? `${message.id}:${index}`;
      const entry = {
        id,
        sourceMessageId: message.id,
        name: String(getToolName(part)),
        state,
        input: "input" in part ? part.input : undefined,
        output: "output" in part ? part.output : undefined,
        errorText: "errorText" in part ? part.errorText : undefined,
        approvalId:
          "approval" in part &&
          part.approval &&
          typeof part.approval.id === "string"
            ? part.approval.id
            : undefined,
        activity: toolCallId
          ? activityByToolCallId.get(toolCallId)
          : undefined,
      };
      if (entriesById.has(id)) entriesById.delete(id);
      entriesById.set(id, entry);
    });
  }
  return Array.from(entriesById.values());
}

export function getReasoningTexts(message: AntonUIMessage): string[] {
  return message.parts
    .filter(isReasoningUIPart)
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0);
}

export function buildReasoningTextByEventId(
  message: AntonUIMessage,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const reasoningActivities = getActivityEvents(message)
    .filter((event) => event.kind === "reasoning")
    .slice()
    .sort(
      (left, right) =>
        left.startedAt - right.startedAt ||
        left.sequence - right.sequence ||
        left.id.localeCompare(right.id),
    );
  const eventsByPartId = new Map<string, AntonActivityEvent[]>();
  for (const event of reasoningActivities) {
    const partId = reasoningPartIdFromEvent(event);
    if (!partId) continue;
    const events = eventsByPartId.get(partId) ?? [];
    events.push(event);
    eventsByPartId.set(partId, events);
  }
  const matchedEventIds = new Set<string>();
  let reasoningIndex = 0;

  for (const part of message.parts) {
    if (!isReasoningUIPart(part)) continue;
    const text = part.text.trim();
    if (!text) continue;

    if ("id" in part && typeof part.id === "string") {
      const matchingEvent =
        eventsByPartId
          .get(part.id)
          ?.find((event) => !matchedEventIds.has(event.id)) ??
        reasoningActivities.find(
          (event) =>
            !matchedEventIds.has(event.id) &&
            event.id.endsWith(`:reasoning:${part.id}`),
        );
      if (matchingEvent) {
        map.set(matchingEvent.id, text);
        matchedEventIds.add(matchingEvent.id);
        reasoningIndex += 1;
        continue;
      }
    }

    const event = reasoningActivities
      .slice(reasoningIndex)
      .find((candidate) => !matchedEventIds.has(candidate.id));
    if (event && !map.has(event.id)) {
      map.set(event.id, text);
      matchedEventIds.add(event.id);
    }
    reasoningIndex += 1;
  }

  return map;
}

function reasoningPartIdFromEvent(event: AntonActivityEvent): string | undefined {
  const details = event.details;
  if (!details) return undefined;
  const value = details.reasoningPartId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isReasoningPart(
  part: AntonUIMessage["parts"][number],
): part is Extract<AntonUIMessage["parts"][number], { type: "reasoning" }> {
  return isReasoningUIPart(part);
}

export function isRunDataPart(
  part: AntonUIMessage["parts"][number],
): part is Extract<AntonUIMessage["parts"][number], { type: "data-run" }> {
  return isDataUIPart(part) && part.type === "data-run";
}

export function isActivityDataPart(
  part: AntonUIMessage["parts"][number],
): part is Extract<AntonUIMessage["parts"][number], { type: "data-activity" }> {
  return isDataUIPart(part) && part.type === "data-activity";
}

export function isTodosDataPart(
  part: AntonUIMessage["parts"][number],
): part is Extract<AntonUIMessage["parts"][number], { type: "data-todos" }> {
  return isDataUIPart(part) && part.type === "data-todos";
}

export function isAssistantTurnActive(message: AntonUIMessage): boolean {
  const runs = getRunDataList(message);
  if (runs.length > 0) {
    return runs.some((run) => run.status === "running");
  }
  const status = getRunData(message)?.status ?? message.metadata?.status;
  return status === "running";
}

export function normalizeTodoSnapshotForDisplay(
  snapshot: AntonTodoSnapshot,
  active: boolean,
): AntonTodoSnapshot {
  if (active) return snapshot;
  if (!snapshot.items.some((item) => item.status === "in_progress")) {
    return snapshot;
  }
  return {
    ...snapshot,
    items: snapshot.items.map((item) =>
      item.status === "in_progress"
        ? { ...item, status: "pending" as const }
        : item,
    ),
  };
}

export function cumulativeRunTokens(message: AntonUIMessage): number {
  return getRunDataList(message).reduce(
    (sum, run) => sum + (run.totalTokens ?? 0),
    0,
  );
}

export function cumulativeRunCostUsd(message: AntonUIMessage): number {
  return getRunDataList(message).reduce(
    (sum, run) => sum + (run.costUsd ?? 0),
    0,
  );
}

export function priorSegmentUsage(
  message: AntonUIMessage,
  excludeRunId?: string,
): { tokensUsed: number; effectiveTokensUsed: number; costUsd: number } {
  return getRunDataList(message)
    .filter((run) => run.runId !== excludeRunId)
    .reduce(
      (totals, run) => ({
        tokensUsed: totals.tokensUsed + (run.rawTotalTokens ?? run.totalTokens ?? 0),
        effectiveTokensUsed:
          totals.effectiveTokensUsed +
          (run.effectiveTokens ?? run.totalTokens ?? 0),
        costUsd: totals.costUsd + (run.costUsd ?? 0),
      }),
      { tokensUsed: 0, effectiveTokensUsed: 0, costUsd: 0 },
    );
}

export function getTodoSnapshots(message: AntonUIMessage): AntonTodoSnapshot[] {
  const snapshots: AntonTodoSnapshot[] = [];
  const firstFailedToolIndex = message.parts.findIndex(isFailedToolPart);
  const firstFailedToolSequence = firstFailedToolActivitySequence(message);
  for (const [index, part] of message.parts.entries()) {
    if (isTodosDataPart(part)) {
      if (firstFailedToolSequence !== undefined) continue;
      if (firstFailedToolIndex !== -1 && index > firstFailedToolIndex) continue;
      snapshots.push(part.data);
    }
    if (isActivityDataPart(part)) {
      if (
        firstFailedToolSequence !== undefined &&
        part.data.sequence > firstFailedToolSequence
      ) {
        continue;
      }
      const todos = todoSnapshotFromUnknown(part.data.details?.todos);
      if (todos) snapshots.push(todos);
    }
  }
  return snapshots.sort((a, b) => a.updatedAt - b.updatedAt);
}

function isFailedToolPart(part: AntonUIMessage["parts"][number]): boolean {
  if (!isToolUIPart(part)) return false;
  return (
    ("state" in part && part.state === "output-error") ||
    ("output" in part && isFailedToolOutput(part.output))
  );
}

function firstFailedToolActivitySequence(
  message: AntonUIMessage,
): number | undefined {
  return getActivityEvents(message)
    .filter((event) => event.kind === "tool" && event.status === "error")
    .sort((a, b) => a.sequence - b.sequence)
    .at(0)?.sequence;
}

function todoSnapshotFromUnknown(value: unknown): AntonTodoSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const runId = value.runId;
  const updatedAt = value.updatedAt;
  const items = value.items;
  if (
    typeof runId !== "string" ||
    typeof updatedAt !== "number" ||
    !Array.isArray(items)
  ) {
    return undefined;
  }
  const parsedItems = items.flatMap((item): AntonTodoItem[] => {
    if (!isRecord(item)) return [];
    const id = item.id;
    const text = item.text;
    const status = item.status;
    if (
      typeof id !== "string" ||
      typeof text !== "string" ||
      (status !== "pending" &&
        status !== "in_progress" &&
        status !== "completed")
    ) {
      return [];
    }
    return [{ id, text, status }];
  });
  if (parsedItems.length === 0) return undefined;
  return { runId, updatedAt, items: parsedItems };
}

export function getLatestTodoSnapshot(
  messages: AntonUIMessage[],
): AntonTodoSnapshot | undefined {
  return messages
    .flatMap((message) => getTodoSnapshots(message))
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .at(-1);
}

export function getPlanMessages(messages: AntonUIMessage[]): AntonUIMessage[] {
  return messages.filter(
    (message) =>
      message.role === "assistant" && message.metadata?.responseKind === "plan",
  );
}
