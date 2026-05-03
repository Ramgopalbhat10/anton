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
  totalTokens?: number;
};

export type AntonRunData = {
  runId: string;
  model: string;
  status: AntonRunStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  totalTokens?: number;
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

export function getRunData(message: AntonUIMessage): AntonRunData | undefined {
  let run: AntonRunData | undefined;
  for (const part of message.parts) {
    if (isRunDataPart(part)) run = part.data;
  }
  return run;
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
        id: `${message.id}:${index}`,
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
