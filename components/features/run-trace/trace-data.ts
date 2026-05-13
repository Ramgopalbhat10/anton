import {
  getActivityEvents,
  getAssistantTextDisplay,
  getRunData,
  getTodoSnapshots,
  getToolTraceEntries,
  hasFailedToolOutput,
  hasPendingToolApproval,
  isReasoningPart,
  isTodosDataPart,
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
      kind: "tool";
      tool: ToolTraceEntry;
    };

export type TodoTraceDisplay = ReadonlyMap<string, AntonTodoSnapshot>;

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
    const messageHasFailedTool = hasFailedToolOutput(message);
    const firstTodoPartIndex = message.parts.findIndex(isTodosDataPart);
    const firstTodoPartKey =
      firstTodoPartIndex === -1
        ? undefined
        : todoPartKey(message, firstTodoPartIndex);
    message.parts.forEach((part, partIndex) => {
      if (!isTodosDataPart(part)) return;
      if (messageHasFailedTool) return;
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

  for (const item of turnTodos.values()) {
    displayByFirstPart.set(item.firstPartKey, item.latestSnapshot);
  }

  return displayByFirstPart;
}

export function getTraceRows(
  message: AntonUIMessage,
  todoDisplay?: TodoTraceDisplay,
): TraceRow[] {
  const activities = getActivityEvents(message);
  const running = (getRunData(message)?.status ?? message.metadata?.status) === "running";
  const reasoningActivities = activities.filter(
    (event) => event.kind === "reasoning",
  );
  const toolEntries = getToolTraceEntries([message]);
  const rows: TraceRow[] = [];
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
      const text = part.text.trim();
      if (!text) return;
      const event = reasoningActivities[reasoningIndex];
      reasoningIndex += 1;
      rows.push({
        id: event?.id ?? `${message.id}:reasoning:${index}`,
        order: index,
        kind: "reasoning",
        event,
        text,
      });
      return;
    }

    if (
      part.type === "text" &&
      !isPlanResponse &&
      (running || index < lastToolIndex)
    ) {
      const text = part.text.trim();
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
      order: index,
      kind: "tool",
      tool,
    });
  });

  for (const event of activities) {
    if (event.kind === "tool" || event.kind === "reasoning") continue;
    if (event.kind === "step") continue;
    if (event.kind === "progress" && eventHasTodos(event)) continue;
    rows.push({
      id: event.id,
      order: 10_000 + event.sequence,
      kind: "activity",
      event,
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
    for (const snapshot of getTodoSnapshots(message)) {
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
