import {
  buildReasoningTextByEventId,
  getActivityEvents,
  getAssistantTextDisplay,
  getLatestBudgetGate,
  getRunData,
  getRunDataList,
  getTodoSnapshots,
  type AntonRunData,
  getToolTraceEntries,
  hasFailedToolOutput,
  hasPendingToolApproval,
  isAssistantTurnActive,
  isReasoningPart,
  isTodosDataPart,
  normalizeTodoSnapshotForDisplay,
  stripLeakedProviderMarkup,
  type AntonActivityKind,
  type AntonActivityStatus,
  type AntonBudgetGateData,
  type AntonRunStatus,
  type AntonActivityEvent,
  type AntonTodoSnapshot,
  type AntonUIMessage,
  type ToolTraceEntry,
} from "@/src/lib/trace";

import { isFailedToolOutput, previewToolInput } from "./tool-display";

export type StepGroup = {
  stepNumber: number;
  order: number;
  toolRows: TraceRow[];
  summary: string;
};

export type TraceRow =
  | {
      id: string;
      order: number;
      kind: "activity";
      event: AntonActivityEvent;
    }
  | {
      id: string;
      order: number;
      kind: "reasoning";
      event?: AntonActivityEvent;
      text: string;
    }
  | {
      id: string;
      order: number;
      kind: "progress";
      text: string;
    }
  | {
      id: string;
      order: number;
      kind: "todos";
      snapshot: AntonTodoSnapshot;
    }
  | {
      id: string;
      order: number;
      kind: "budget-gate";
      gate: AntonBudgetGateData;
    }
  | {
      id: string;
      order: number;
      kind: "tool";
      tool: ToolTraceEntry;
    };

export type TodoTraceDisplay = ReadonlyMap<string, AntonTodoSnapshot>;

export type SessionTimelineItem = {
  id: string;
  order: number;
  startedAt: number;
  runId: string;
  kind: AntonActivityKind | "progress" | "todos";
  label: string;
  summary?: string;
  durationMs?: number;
  status: AntonActivityStatus;
  expandable: boolean;
  tool?: ToolTraceEntry;
  reasoningText?: string;
  todoSnapshot?: AntonTodoSnapshot;
  messageId: string;
  runStatus: AntonRunStatus;
};

export type TimelineStepGroup<T extends TimelineStepBoundaryItem> = {
  id: string;
  label: string;
  durationMs?: number;
  items: T[];
};

export type TimelineStepBoundaryItem = {
  kind: string;
  id: string;
  label: string;
  startedAt?: number;
  durationMs?: number | null;
};

export type SessionTimelineStepGroup = TimelineStepGroup<SessionTimelineItem>;

export type SessionTimelineRunGroup = {
  runId: string;
  messageId: string;
  run: AntonRunData;
  segmentIndex: number;
  segmentCount: number;
  items: SessionTimelineItem[];
  steps: SessionTimelineStepGroup[];
};

export function groupTimelineItemsByStep<T extends TimelineStepBoundaryItem>(
  items: readonly T[],
  options?: { tailLabel?: string; activityLabel?: string },
): TimelineStepGroup<T>[] {
  const activityLabel = options?.activityLabel ?? "Activity";
  const tailLabel = options?.tailLabel ?? "In progress";

  if (items.length === 0) return [];

  const stepEvents = items
    .filter((item) => item.kind === "step")
    .slice()
    .sort(
      (left, right) =>
        (left.startedAt ?? 0) - (right.startedAt ?? 0) ||
        left.id.localeCompare(right.id),
    );
  const nonStepItems = items.filter((item) => item.kind !== "step");

  if (stepEvents.length === 0) {
    return [
      {
        id: `activity:${items[0]?.id ?? "unknown"}`,
        label: activityLabel,
        items: nonStepItems.slice(),
      },
    ];
  }

  const steps: TimelineStepGroup<T>[] = stepEvents.map((step, index) => {
    const stepStart = step.startedAt ?? 0;
    const nextStepStart = stepEvents[index + 1]?.startedAt ?? Number.POSITIVE_INFINITY;
    const stepItems = nonStepItems
      .filter(
        (item) =>
          (item.startedAt ?? 0) >= stepStart &&
          (item.startedAt ?? 0) < nextStepStart,
      )
      .slice()
      .sort(
        (left, right) =>
          (left.startedAt ?? 0) - (right.startedAt ?? 0) ||
          left.id.localeCompare(right.id),
      );

    return {
      id: step.id,
      label: step.label,
      durationMs: stepDisplayDurationMs(step, stepItems),
      items: stepItems,
    };
  });

  const assigned = new Set(steps.flatMap((step) => step.items));
  const leading = nonStepItems
    .filter((item) => !assigned.has(item))
    .filter((item) => (item.startedAt ?? 0) < (stepEvents[0]?.startedAt ?? 0));
  if (leading.length > 0) {
    steps.unshift({
      id: `leading:${leading[0]?.id ?? "unknown"}`,
      label: activityLabel,
      items: leading,
    });
  }

  const leadingIds = new Set(leading.map((item) => item.id));
  const trailing = nonStepItems.filter(
    (item) => !assigned.has(item) && !leadingIds.has(item.id),
  );
  if (trailing.length > 0) {
    steps.push({
      id: `tail:${trailing[0]?.id ?? "unknown"}`,
      label: tailLabel,
      items: trailing,
    });
  }

  return steps;
}

function stepDisplayDurationMs(
  step: TimelineStepBoundaryItem,
  items: readonly TimelineStepBoundaryItem[],
): number | undefined {
  const stepStart = step.startedAt;
  const harnessDuration =
    typeof step.durationMs === "number" && Number.isFinite(step.durationMs)
      ? step.durationMs
      : undefined;

  if (stepStart === undefined) return harnessDuration;

  let envelopeEnd = stepStart + (harnessDuration ?? 0);
  for (const item of items) {
    const itemStart = item.startedAt;
    if (itemStart === undefined) continue;
    const itemEnd =
      typeof item.durationMs === "number" && Number.isFinite(item.durationMs)
        ? itemStart + item.durationMs
        : itemStart;
    envelopeEnd = Math.max(envelopeEnd, itemEnd);
  }

  const envelopeDuration = Math.max(0, envelopeEnd - stepStart);
  if (harnessDuration === undefined) {
    return envelopeDuration > 0 ? envelopeDuration : undefined;
  }
  return Math.max(harnessDuration, envelopeDuration);
}

export function getSessionTimelineRunGroups(
  messages: AntonUIMessage[],
): SessionTimelineRunGroup[] {
  const groups: SessionTimelineRunGroup[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") continue;

    const runs = getRunsForTimelineMessage(message);
    runs.forEach((run, index) => {
      const items = buildRunTimelineItems(message, run);
      if (items.length === 0) return;
      groups.push({
        runId: run.runId,
        messageId: message.id,
        run,
        segmentIndex: index + 1,
        segmentCount: runs.length,
        items,
        steps: groupTimelineItemsByStep(items),
      });
    });
  }

  return groups;
}

export function getSessionTimelineItems(
  messages: AntonUIMessage[],
): SessionTimelineItem[] {
  return getSessionTimelineRunGroups(messages).flatMap((group) => group.items);
}

function getRunsForTimelineMessage(message: AntonUIMessage): AntonRunData[] {
  const fromParts = getRunDataList(message);
  if (fromParts.length > 0) {
    return fromParts.slice().sort((left, right) => left.startedAt - right.startedAt);
  }

  const fallbackStartedAt = new Map<string, number>();
  for (const event of getActivityEvents(message)) {
    const current = fallbackStartedAt.get(event.runId);
    if (current === undefined || event.startedAt < current) {
      fallbackStartedAt.set(event.runId, event.startedAt);
    }
  }

  return Array.from(fallbackStartedAt.entries())
    .sort((left, right) => left[1] - right[1])
    .map(([runId, startedAt]) => ({
      runId,
      model: message.metadata?.model ?? "unknown",
      status: message.metadata?.status ?? "completed",
      startedAt,
    }));
}

function buildRunTimelineItems(
  message: AntonUIMessage,
  run: AntonRunData,
): SessionTimelineItem[] {
  const runStatus = run.status;
  const toolByCallId = new Map(
    getToolTraceEntries([message])
      .filter((tool) => tool.activity?.runId === run.runId)
      .map((tool) => [tool.id, tool]),
  );
  const seenToolIds = new Set<string>();
  const items: SessionTimelineItem[] = [];
  const reasoningByEventId = buildReasoningTextByEventId(message);

  const events = getActivityEvents(message)
    .filter(
      (event) =>
        event.runId === run.runId &&
        event.kind !== "approval" &&
        !isTokenBudgetActivity(event),
    )
    .sort(compareTimelineEvents);

  for (const event of events) {
    const base = {
      id: event.id,
      order: event.sequence,
      startedAt: event.startedAt,
      runId: run.runId,
      messageId: message.id,
      runStatus,
    };

    if (event.kind === "tool" && event.toolCallId) {
      const tool = toolByCallId.get(event.toolCallId);
      if (!tool) continue;
      seenToolIds.add(tool.id);
      items.push({
        ...base,
        kind: "tool",
        label: event.label,
        summary: event.summary,
        durationMs: activityDisplayDurationMs(event),
        status: event.status,
        tool,
        expandable: true,
      });
      continue;
    }

    if (event.kind === "reasoning") {
      const reasoningText = reasoningTextForEvent(
        message,
        event,
        reasoningByEventId,
      );
      const durationMs = activityDisplayDurationMs(event);
      items.push({
        ...base,
        kind: "reasoning",
        label:
          durationMs !== undefined
            ? `Thought for ${formatDuration(durationMs)}`
            : event.label,
        durationMs,
        status: event.status,
        reasoningText,
        expandable: Boolean(reasoningText),
      });
      continue;
    }

    if (event.kind === "progress" && eventHasTodos(event)) {
      const todoSnapshot = todoSnapshotFromEventDetails(event.details?.todos);
      items.push({
        ...base,
        kind: "todos",
        label: event.label || "Todos updated",
        summary: event.summary,
        durationMs: activityDisplayDurationMs(event),
        status: event.status,
        todoSnapshot,
        expandable: Boolean(todoSnapshot),
      });
      continue;
    }

    items.push({
      ...base,
      kind: event.kind,
      label: event.label,
      summary: event.summary,
      durationMs: activityDisplayDurationMs(event),
      status: event.status,
      expandable:
        (event.kind === "error" && Boolean(event.summary)) ||
        (event.kind === "progress" && Boolean(event.summary)),
    });
  }

  for (const tool of toolByCallId.values()) {
    if (seenToolIds.has(tool.id)) continue;
    const title = toolTitle(tool, runStatus);
    const label = title.target ? `${title.verb} ${title.target}` : title.verb;
    items.push({
      id: tool.activity?.id ?? tool.id,
      order: tool.activity?.sequence ?? items.length,
      startedAt: tool.activity?.startedAt ?? run.startedAt,
      runId: run.runId,
      kind: "tool",
      label: tool.activity?.label ?? label,
      durationMs: tool.activity
        ? activityDisplayDurationMs(tool.activity)
        : undefined,
      status:
        tool.activity?.status ??
        (runStatus === "running" ? "running" : "completed"),
      tool,
      expandable: true,
      messageId: message.id,
      runStatus,
    });
  }

  return items.sort(compareTimelineItems);
}

export function activityDisplayDurationMs(
  event: AntonActivityEvent,
): number | undefined {
  if (event.durationMs !== undefined) return event.durationMs;
  if (event.finishedAt !== undefined) {
    return Math.max(0, event.finishedAt - event.startedAt);
  }
  if (event.status !== "running") return 0;
  return undefined;
}

function compareTimelineEvents(
  left: AntonActivityEvent,
  right: AntonActivityEvent,
): number {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt - right.startedAt;
  }
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  return left.id.localeCompare(right.id);
}

function compareTimelineItems(
  left: SessionTimelineItem,
  right: SessionTimelineItem,
): number {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt - right.startedAt;
  }
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  return left.id.localeCompare(right.id);
}

function reasoningTextForEvent(
  message: AntonUIMessage,
  event: AntonActivityEvent,
  reasoningByEventId?: ReadonlyMap<string, string>,
): string | undefined {
  const summary = event.summary?.trim();
  if (summary) return summary;
  if (event.status === "running") return undefined;
  const map = reasoningByEventId ?? buildReasoningTextByEventId(message);
  return map.get(event.id);
}

function todoSnapshotFromEventDetails(
  value: unknown,
): AntonTodoSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const runId = record.runId;
  const updatedAt = record.updatedAt;
  const items = record.items;
  if (
    typeof runId !== "string" ||
    typeof updatedAt !== "number" ||
    !Array.isArray(items)
  ) {
    return undefined;
  }

  const parsedItems = items.flatMap((item): AntonTodoSnapshot["items"] => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const id = row.id;
    const text = row.text;
    const status = row.status;
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

export function runIdFromEventId(eventId: string): string {
  const match = eventId.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return match?.[1] ?? eventId;
}

/** Harness / AI SDK step indices are 0-based; step timeline headers use 1-based labels. */
export function harnessStepDisplayNumber(stepNumber: number): number {
  return stepNumber + 1;
}

export function isTimelineHarnessStepGroup(stepId: string): boolean {
  return !stepId.startsWith("leading:") && !stepId.startsWith("tail:");
}

export function runTimelineGroupLabel(group: SessionTimelineRunGroup): string {
  const { run, segmentIndex, segmentCount } = group;
  const segmentLabel =
    segmentCount > 1 ? `Segment ${segmentIndex}/${segmentCount}` : "Run";
  const duration =
    run.durationMs !== undefined ? formatDuration(run.durationMs) : undefined;
  const finishLabel =
    run.finishReason === "token_budget_limit"
      ? "budget reached"
      : run.finishReason === "max_step_limit"
        ? "step limit"
        : run.finishReason === "cost_budget_limit"
          ? "cost limit"
          : undefined;

  return [
    segmentLabel,
    segmentIndex > 1 ? "continued" : undefined,
    duration,
    finishLabel,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

export function getTodoTraceDisplay(
  messages: AntonUIMessage[],
): TodoTraceDisplay {
  const displayByFirstPart = new Map<string, AntonTodoSnapshot>();
  const turnTodos = new Map<
    number,
    {
      firstPartKey: string;
      latestSnapshot: AntonTodoSnapshot;
      latestOrder: number;
    }
  >();
  let userTurn = 0;
  const lastAssistantByTurn = new Map<number, AntonUIMessage>();

  const updateTurnSnapshot = (
    turn: number,
    snapshot: AntonTodoSnapshot,
    order: number,
    firstPartKey?: string,
  ) => {
    const current = turnTodos.get(turn);
    if (!current) {
      if (!firstPartKey) return;
      turnTodos.set(turn, {
        firstPartKey,
        latestSnapshot: snapshot,
        latestOrder: order,
      });
      return;
    }
    if (
      snapshot.updatedAt > current.latestSnapshot.updatedAt ||
      (snapshot.updatedAt === current.latestSnapshot.updatedAt &&
        order > current.latestOrder)
    ) {
      current.latestSnapshot = snapshot;
      current.latestOrder = order;
    }
  };

  messages.forEach((message, messageIndex) => {
    if (message.role === "user") userTurn += 1;
    if (message.role === "assistant") {
      lastAssistantByTurn.set(userTurn, message);
    }
    const firstTodoPartIndex = message.parts.findIndex(isTodosDataPart);
    const firstTodoPartKey =
      firstTodoPartIndex === -1
        ? undefined
        : todoPartKey(message, firstTodoPartIndex);
    message.parts.forEach((part, partIndex) => {
      if (!isTodosDataPart(part)) return;
      const order = messageIndex * 10_000 + partIndex;
      updateTurnSnapshot(userTurn, part.data, order, todoPartKey(message, partIndex));
    });
    getTodoSnapshots(message).forEach((snapshot, snapshotIndex) => {
      updateTurnSnapshot(
        userTurn,
        snapshot,
        messageIndex * 10_000 + message.parts.length + snapshotIndex,
        firstTodoPartKey,
      );
    });
    const current = turnTodos.get(userTurn);
    if (
      current &&
      hasOpenTodos(current.latestSnapshot) &&
      isSuccessfulCompletionMessage(message)
    ) {
      updateTurnSnapshot(
        userTurn,
        completedTodoSnapshot(current.latestSnapshot, message),
        messageIndex * 10_000 + message.parts.length + 1_000,
      );
    }
  });

  for (const [turn, item] of turnTodos.entries()) {
    const lastAssistant = lastAssistantByTurn.get(turn);
    const active = lastAssistant ? isAssistantTurnActive(lastAssistant) : false;
    displayByFirstPart.set(
      item.firstPartKey,
      normalizeTodoSnapshotForDisplay(item.latestSnapshot, active),
    );
  }

  return displayByFirstPart;
}

export function getTraceRows(
  message: AntonUIMessage,
  todoDisplay?: TodoTraceDisplay,
): TraceRow[] {
  const activities = getActivityEvents(message);
  const reasoningActivities = activities.filter(
    (event) => event.kind === "reasoning",
  );
  const reasoningByEventId = buildReasoningTextByEventId(message);
  const toolEntries = getToolTraceEntries([message]);
  const rows: TraceRow[] = [];
  const representedActivityIds = new Set<string>();
  const isPlanResponse = message.metadata?.responseKind === "plan";
  let reasoningIndex = 0;
  const lastToolIndex = message.parts.findLastIndex((part) =>
    toolCallIdForPart(part)
      ? toolEntries.some((entry) => entry.id === toolCallIdForPart(part))
      : false,
  );
  const latestToolPartIndexes = getLatestToolPartIndexes(message);
  const latestTodoPartIndexes = todoDisplay
    ? undefined
      : getLatestTodoPartIndexes(message);
  message.parts.forEach((part, index) => {
    if (isReasoningPart(part)) {
      if (reasoningActivities.length > 0) return;
      const text = part.text.trim();
      if (!text) return;
      const event = reasoningActivities[reasoningIndex];
      reasoningIndex += 1;
      rows.push({
        id: event?.id ?? `${message.id}:reasoning:${index}`,
        order: event?.sequence ?? index,
        kind: "reasoning",
        event,
        text,
      });
      if (event) representedActivityIds.add(event.id);
      return;
    }

    if (
      part.type === "text" &&
      !isPlanResponse &&
      lastToolIndex !== -1 &&
      index < lastToolIndex
    ) {
      const text = stripLeakedProviderMarkup(part.text);
      if (!text) return;
      rows.push({
        id: `${message.id}:progress:${index}`,
        order: index,
        kind: "progress",
        text,
      });
      return;
    }

    if (isTodosDataPart(part)) {
      const todoSnapshot = todoDisplay
        ? todoDisplay.get(todoPartKey(message, index))
        : latestTodoPartIndexes?.has(index)
          ? part.data
          : undefined;
      if (!todoSnapshot) return;
      rows.push({
        id: part.id ?? `${message.id}:todos:${index}`,
        order: index,
        kind: "todos",
        snapshot: todoSnapshot,
      });
      return;
    }

    const toolCallId = toolCallIdForPart(part);
    if (!toolCallId) return;
    if (!latestToolPartIndexes.has(index)) return;
    const tool = toolEntries.find((entry) => entry.id === toolCallId);
    if (!tool) return;
    if (tool.name === "update_todos") return;
    rows.push({
      id: tool.id,
      order: tool.activity?.sequence ?? index,
      kind: "tool",
      tool,
    });
    if (tool.activity) representedActivityIds.add(tool.activity.id);
  });

  for (const event of activities) {
    if (representedActivityIds.has(event.id)) continue;
    if (event.kind === "reasoning") {
      const text = reasoningTextForEvent(
        message,
        event,
        reasoningByEventId,
      );
      if (!text) continue;
      rows.push({
        id: event.id,
        order: event.sequence,
        kind: "reasoning",
        event,
        text,
      });
      continue;
    }
    if (event.kind === "tool") {
      rows.push({
        id: event.id,
        order: event.sequence,
        kind: "activity",
        event,
      });
      continue;
    }
    if (event.kind === "step") continue;
    if (event.kind === "progress" && eventHasTodos(event)) continue;
    if (isTokenBudgetActivity(event)) continue;
    rows.push({
      id: event.id,
      order: event.sequence,
      kind: "activity",
      event,
    });
  }

  const budgetGate = getLatestBudgetGate(message);
  if (budgetGate && budgetGate.status !== "resolved") {
    rows.push({
      id: `${budgetGate.runId}:budget-gate`,
      order: 20_000,
      kind: "budget-gate",
      gate: budgetGate,
    });
  }

  return rows.sort((a, b) => a.order - b.order);
}

function getLatestToolPartIndexes(message: AntonUIMessage): Set<number> {
  const latestByToolCallId = new Map<string, number>();
  message.parts.forEach((part, index) => {
    const toolCallId = toolCallIdForPart(part);
    if (!toolCallId) return;
    latestByToolCallId.set(toolCallId, index);
  });
  return new Set(latestByToolCallId.values());
}

function getLatestTodoPartIndexes(message: AntonUIMessage): Set<number> {
  const latestByRunId = new Map<
    string,
    { index: number; updatedAt: number }
  >();

  message.parts.forEach((part, index) => {
    if (!isTodosDataPart(part)) return;
    const current = latestByRunId.get(part.data.runId);
    if (
      !current ||
      part.data.updatedAt > current.updatedAt ||
      (part.data.updatedAt === current.updatedAt && index > current.index)
    ) {
      latestByRunId.set(part.data.runId, {
        index,
        updatedAt: part.data.updatedAt,
      });
    }
  });

  return new Set(Array.from(latestByRunId.values(), (item) => item.index));
}

function todoPartKey(message: AntonUIMessage, partIndex: number): string {
  return `${message.id}:todos:${partIndex}`;
}

function eventHasTodos(event: AntonActivityEvent): boolean {
  return (
    typeof event.details === "object" &&
    event.details !== null &&
    "todos" in event.details
  );
}

function isTokenBudgetActivity(event: AntonActivityEvent): boolean {
  return event.label === "Token budget reached";
}

function toolCallIdForPart(
  part: AntonUIMessage["parts"][number],
): string | undefined {
  return "toolCallId" in part && typeof part.toolCallId === "string"
    ? part.toolCallId
    : undefined;
}

export function groupTraceRowsByStep(
  _message: AntonUIMessage,
  rows: TraceRow[],
): StepGroup[] {
  const orderedRows = rows.toSorted((a, b) => a.order - b.order);
  const boundaryRows = orderedRows.filter(
    (row) => row.kind === "reasoning" || row.kind === "progress",
  );
  const groups: StepGroup[] = [];

  const addGroup = (toolRows: TraceRow[]) => {
    if (toolRows.length === 0) return;
    groups.push({
      stepNumber: groups.length,
      order: toolRows[0]?.order ?? 500,
      toolRows,
      summary: buildStepSummary(toolRows),
    });
  };

  if (boundaryRows.length === 0) {
    addGroup(orderedRows.filter((row) => row.kind === "tool"));
    return groups;
  }

  addGroup(
    orderedRows.filter(
      (row) => row.kind === "tool" && row.order < boundaryRows[0].order,
    ),
  );

  boundaryRows.forEach((boundaryRow, index) => {
    const nextBoundaryRow = boundaryRows[index + 1];
    addGroup(
      orderedRows.filter(
        (row) =>
          row.kind === "tool" &&
          row.order > boundaryRow.order &&
          (nextBoundaryRow === undefined ||
            row.order < nextBoundaryRow.order),
      ),
    );
  });

  return groups;
}

function buildStepSummary(toolRows: TraceRow[]): string {
  const counts: Record<string, number> = {};
  for (const row of toolRows) {
    if (row.kind !== "tool") continue;
    const name = row.tool.name;
    if (name === "bash") {
      counts["command"] = (counts["command"] ?? 0) + 1;
    } else if (name === "read_file") {
      counts["file"] = (counts["file"] ?? 0) + 1;
    } else if (name === "read_dir" || name === "stat" || name === "glob") {
      counts["list"] = (counts["list"] ?? 0) + 1;
    } else if (name === "write_file") {
      counts["edit"] = (counts["edit"] ?? 0) + 1;
    } else if (name === "edit_file") {
      counts["edit"] = (counts["edit"] ?? 0) + 1;
    } else if (
      name === "mkdir" ||
      name === "delete" ||
      name === "rename" ||
      name === "copy" ||
      name === "format" ||
      name === "git_commit" ||
      name === "git_restore" ||
      name === "revert_changes"
    ) {
      counts["edit"] = (counts["edit"] ?? 0) + 1;
    } else if (
      name === "git_status" ||
      name === "git_diff" ||
      name === "git_show" ||
      name === "git_branch"
    ) {
      counts["list"] = (counts["list"] ?? 0) + 1;
    } else if (name === "grep") {
      counts["search"] = (counts["search"] ?? 0) + 1;
    } else {
      counts["action"] = (counts["action"] ?? 0) + 1;
    }
  }

  const parts: string[] = [];
  if (counts["list"]) {
    parts.push(`Listed ${counts["list"]} glob${counts["list"] > 1 ? "s" : ""}`);
  }
  if (counts["search"]) {
    parts.push(`searched ${counts["search"]} time${counts["search"] > 1 ? "s" : ""}`);
  }
  if (counts["file"]) {
    parts.push(`read ${counts["file"]} file${counts["file"] > 1 ? "s" : ""}`);
  }
  if (counts["command"]) {
    parts.push(`ran ${counts["command"]} command${counts["command"] > 1 ? "s" : ""}`);
  }
  if (counts["edit"]) {
    parts.push(`edited ${counts["edit"]} file${counts["edit"] > 1 ? "s" : ""}`);
  }
  if (counts["action"]) {
    parts.push(`${counts["action"]} action${counts["action"] > 1 ? "s" : ""}`);
  }

  if (parts.length === 0) return `${toolRows.length} tool call${toolRows.length > 1 ? "s" : ""}`;
  const [first, ...rest] = parts;
  if (rest.length === 0) return first;
  if (rest.length === 1) return `${first} and ${rest[0]}`;
  return `${first}, ${rest.slice(0, -1).join(", ")} and ${rest.at(-1)}`;
}

export function getTraceDurationMs(rows: TraceRow[]): number | undefined {
  const durations = rows
    .map((row) => {
      if (row.kind === "activity") return row.event.durationMs;
      if (row.kind === "reasoning") return row.event?.durationMs;
      if (row.kind === "progress") return undefined;
      if (row.kind === "todos") return undefined;
      if (row.kind === "budget-gate") return undefined;
      return row.tool.activity?.durationMs;
    })
    .filter((duration): duration is number => duration !== undefined);
  if (durations.length === 0) return undefined;
  return durations.reduce((sum, duration) => sum + duration, 0);
}

export function getModelTurnSummary(
  message: AntonUIMessage,
): string | undefined {
  const turns = getActivityEvents(message).filter(
    (event) => event.kind === "step",
  );
  if (turns.length === 0) return undefined;
  return `Model turns: ${turns
    .map((turn, index) => {
      const duration = turn.durationMs;
      return duration === undefined
        ? `${index + 1}`
        : `${index + 1} ${formatDuration(duration)}`;
    })
    .join(", ")}`;
}

export function getSessionTodoSnapshots(
  messages: AntonUIMessage[],
): AntonTodoSnapshot[] {
  const snapshots: AntonTodoSnapshot[] = [];
  let latest: AntonTodoSnapshot | undefined;

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isTodosDataPart(part)) continue;
      snapshots.push(part.data);
      if (
        !latest ||
        part.data.updatedAt > latest.updatedAt ||
        (part.data.updatedAt === latest.updatedAt &&
          snapshots.indexOf(part.data) > snapshots.indexOf(latest))
      ) {
        latest = part.data;
      }
    }

    for (const snapshot of getTodoSnapshots(message)) {
      if (snapshots.some((existing) => existing.updatedAt === snapshot.updatedAt && existing.runId === snapshot.runId)) {
        continue;
      }
      snapshots.push(snapshot);
      if (
        !latest ||
        snapshot.updatedAt > latest.updatedAt ||
        (snapshot.updatedAt === latest.updatedAt &&
          snapshots.indexOf(snapshot) > snapshots.indexOf(latest))
      ) {
        latest = snapshot;
      }
    }

    if (latest && hasOpenTodos(latest) && isSuccessfulCompletionMessage(message)) {
      latest = completedTodoSnapshot(latest, message);
      snapshots.push(latest);
    }
  }

  const lastAssistant = messages.findLast((message) => message.role === "assistant");
  const active = lastAssistant ? isAssistantTurnActive(lastAssistant) : false;
  if (latest) {
    latest = normalizeTodoSnapshotForDisplay(latest, active);
    const latestIndex = snapshots.findLastIndex(
      (snapshot) =>
        snapshot.updatedAt === latest?.updatedAt &&
        snapshot.runId === latest.runId,
    );
    if (latestIndex !== -1) {
      snapshots[latestIndex] = latest;
    }
  }

  return snapshots.sort((a, b) => a.updatedAt - b.updatedAt);
}

function hasOpenTodos(snapshot: AntonTodoSnapshot): boolean {
  return snapshot.items.some((item) => item.status !== "completed");
}

function completedTodoSnapshot(
  snapshot: AntonTodoSnapshot,
  message: AntonUIMessage,
): AntonTodoSnapshot {
  const run = getRunData(message);
  const finishedAt = run?.finishedAt ?? message.metadata?.finishedAt;
  return {
    runId: run?.runId ?? message.metadata?.runId ?? snapshot.runId,
    items: snapshot.items.map((item) => ({
      ...item,
      status: "completed",
    })),
    updatedAt: Math.max(snapshot.updatedAt + 1, finishedAt ?? 0),
  };
}

function isSuccessfulCompletionMessage(message: AntonUIMessage): boolean {
  if (message.role !== "assistant") return false;
  if (message.metadata?.responseKind === "plan") return false;
  if (hasPendingToolApproval(message)) return false;
  if (hasFailedToolOutput(message)) return false;
  const runStatus = getRunData(message)?.status ?? message.metadata?.status;
  if (runStatus === "running" || runStatus === "error" || runStatus === "aborted") {
    return false;
  }

  const text = getAssistantTextDisplay(message).finalText.toLowerCase();
  if (!text) return false;
  const positiveCompletion =
    /\b(complete|completed|done|passed|passes)\b/.test(text);
  const negativeCompletion =
    /\b(failed|fails|error|blocked|unable|cannot|couldn't|could not)\b/.test(
      text,
    );
  return positiveCompletion && !negativeCompletion;
}

export function toolTitle(entry: ToolTraceEntry, runStatus?: AntonRunStatus): {
  verb: string;
  target?: string;
} {
  const target = previewToolInput(entry.input);
  if (entry.state === "output-available" && isFailedToolOutput(entry.output)) {
    return { verb: failedToolVerb(entry.name), target };
  }
  switch (entry.name) {
    case "bash":
      return { verb: bashVerb(entry, runStatus), target };
    case "read_file":
      return { verb: "Read", target };
    case "read_dir":
      return { verb: "Listed", target };
    case "stat":
      return { verb: "Inspected", target };
    case "glob":
      return { verb: "Listed", target };
    case "grep":
      return { verb: "Searched", target };
    case "write_file":
      return { verb: "Edited", target };
    case "edit_file":
      return { verb: "Patched", target };
    case "mkdir":
      return { verb: "Created", target };
    case "delete":
      return { verb: "Deleted", target };
    case "rename":
      return { verb: "Renamed", target };
    case "copy":
      return { verb: "Copied", target };
    case "format":
      return { verb: "Formatted", target };
    case "git_status":
      return { verb: "Checked git status", target };
    case "git_diff":
      return { verb: "Inspected git diff", target };
    case "git_show":
      return { verb: "Inspected git revision", target };
    case "git_branch":
      return { verb: "Managed git branch", target };
    case "git_commit":
      return { verb: "Committed", target };
    case "git_restore":
      return { verb: "Restored", target };
    case "revert_changes":
      return { verb: "Reverted", target };
    default:
      return {
        verb: entry.activity?.label ?? entry.name,
        target: target.length > 0 ? target : undefined,
      };
  }
}

function failedToolVerb(name: string): string {
  switch (name) {
    case "format":
      return "Format failed";
    case "git_status":
      return "Git status failed";
    case "git_diff":
      return "Git diff failed";
    case "git_show":
      return "Git show failed";
    case "git_branch":
      return "Git branch failed";
    case "git_commit":
      return "Commit failed";
    case "git_restore":
      return "Restore failed";
    case "revert_changes":
      return "Revert failed";
    default:
      return "Tool failed";
  }
}

function bashVerb(entry: ToolTraceEntry, runStatus?: AntonRunStatus): string {
  if (entry.state === "output-available" || entry.state === "output-error") {
    return "Ran";
  }
  if (entry.state === "output-denied") return "Denied";
  if (entry.state === "approval-requested") return "Review";
  if (runStatus !== undefined && runStatus !== "running") return "Stopped";
  return "Running";
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}
