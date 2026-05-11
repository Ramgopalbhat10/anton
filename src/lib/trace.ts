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

export type AntonRunMetricSnapshot = {
  id: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
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

export function getAssistantTextDisplay(
  message: AntonUIMessage,
  options: { progressOnly?: boolean } = {},
): AssistantTextDisplay {
  const lastToolIndex = message.parts.findLastIndex(isToolUIPart);
  const progressText: string[] = [];
  const finalText: string[] = [];

  for (const [index, part] of message.parts.entries()) {
    if (part.type !== "text") continue;
    const text = part.text.trim();
    if (!text) continue;
    if (options.progressOnly || (lastToolIndex !== -1 && index < lastToolIndex)) {
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
    bashClassification: command?.classification,
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

  return (next ?? value) as T;
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
