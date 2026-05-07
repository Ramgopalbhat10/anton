import {
  getActivityEvents,
  getRunData,
  getToolTraceEntries,
  isReasoningPart,
  type AntonRunStatus,
  type AntonActivityEvent,
  type AntonUIMessage,
  type ToolTraceEntry,
} from "@/src/lib/trace";

import { previewToolInput } from "./tool-display";

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
      kind: "tool";
      tool: ToolTraceEntry;
    };

export function getTraceRows(message: AntonUIMessage): TraceRow[] {
  const activities = getActivityEvents(message);
  const running = (getRunData(message)?.status ?? message.metadata?.status) === "running";
  const reasoningActivities = activities.filter(
    (event) => event.kind === "reasoning",
  );
  const toolEntries = getToolTraceEntries([message]);
  const rows: TraceRow[] = [];
  let reasoningIndex = 0;
  const lastToolIndex = message.parts.findLastIndex((part) =>
    toolCallIdForPart(part)
      ? toolEntries.some((entry) => entry.id === toolCallIdForPart(part))
      : false,
  );

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

    if (part.type === "text" && (running || index < lastToolIndex)) {
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

    const toolCallId = toolCallIdForPart(part);
    if (!toolCallId) return;
    const tool = toolEntries.find((entry) => entry.id === toolCallId);
    if (!tool) return;
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
    rows.push({
      id: event.id,
      order: 10_000 + event.sequence,
      kind: "activity",
      event,
    });
  }

  return rows.sort((a, b) => a.order - b.order);
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
    } else if (name === "write_file") {
      counts["edit"] = (counts["edit"] ?? 0) + 1;
    } else if (name === "grep") {
      counts["search"] = (counts["search"] ?? 0) + 1;
    } else if (name === "glob") {
      counts["list"] = (counts["list"] ?? 0) + 1;
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

export function toolTitle(entry: ToolTraceEntry, runStatus?: AntonRunStatus): {
  verb: string;
  target?: string;
} {
  const target = previewToolInput(entry.input);
  switch (entry.name) {
    case "bash":
      return { verb: bashVerb(entry, runStatus), target };
    case "read_file":
      return { verb: "Read", target };
    case "glob":
      return { verb: "Listed", target };
    case "grep":
      return { verb: "Searched", target };
    case "write_file":
      return { verb: "Edited", target };
    default:
      return {
        verb: entry.activity?.label ?? entry.name,
        target: target.length > 0 ? target : undefined,
      };
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
