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
  model?: string;
  status?: AntonRunStatus;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
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
  costUsd?: number;
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

export type AntonDataParts = {
  run: AntonRunData;
  activity: AntonActivityEvent;
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

export type ApprovalMetadata = {
  riskCategories: string[];
  riskSummary: string;
  bashClassification?: {
    categories: string[];
    forbidden: boolean;
    reason: string;
  };
};

export function getApprovalMetadata(
  entry: ToolTraceEntry,
): ApprovalMetadata | undefined {
  const details = entry.activity?.details;
  if (!details) return undefined;
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
    };
  }
  return {
    riskCategories:
      entry.name === "bash" && bashClassification?.categories.length
        ? bashClassification.categories
        : riskCategories,
    riskSummary,
    bashClassification,
  };
}

export type AssistantTextDisplay = {
  progressText: string;
  finalText: string;
};

export function getAssistantTextDisplay(
  message: AntonUIMessage,
): AssistantTextDisplay {
  const lastToolIndex = message.parts.findLastIndex(isToolUIPart);
  const progressText: string[] = [];
  const finalText: string[] = [];

  for (const [index, part] of message.parts.entries()) {
    if (part.type !== "text") continue;
    const text = part.text.trim();
    if (!text) continue;
    if (lastToolIndex !== -1 && index < lastToolIndex) {
      progressText.push(text);
    } else {
      finalText.push(text);
    }
  }

  return {
    progressText: progressText.join("\n\n"),
    finalText: finalText.join("\n\n"),
  };
}

export function hasPendingToolApproval(message: AntonUIMessage): boolean {
  return getToolTraceEntries([message]).some(
    (entry) => entry.state === "approval-requested",
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
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
  const entries: ToolTraceEntry[] = [];
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
      entries.push({
        id: toolCallId ?? `${message.id}:${index}`,
        sourceMessageId: message.id,
        name: String(getToolName(part)),
        state,
        input: "input" in part ? part.input : undefined,
        output: "output" in part ? part.output : undefined,
        errorText: "errorText" in part ? part.errorText : undefined,
        approvalId:
          state === "approval-requested" && "approval" in part && part.approval
            ? part.approval.id
            : undefined,
        activity: toolCallId
          ? activityByToolCallId.get(toolCallId)
          : undefined,
      });
    });
  }
  return entries;
}

export function getReasoningTexts(message: AntonUIMessage): string[] {
  return message.parts
    .filter(isReasoningUIPart)
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0);
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
