import {
  getActivityEvents,
  getReasoningTexts,
  getToolTraceEntries,
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
      kind: "tool";
      tool: ToolTraceEntry;
    };

export function getTraceRows(message: AntonUIMessage): TraceRow[] {
  const activities = getActivityEvents(message);
  const reasoningTexts = getReasoningTexts(message);
  const reasoningActivities = activities.filter(
    (event) => event.kind === "reasoning",
  );
  const toolEntries = getToolTraceEntries([message]);
  const rows: TraceRow[] = [];

  for (const event of activities) {
    if (event.kind === "tool" || event.kind === "reasoning") continue;
    if (event.kind === "step") continue;
    rows.push({
      id: event.id,
      order: event.sequence,
      kind: "activity",
      event,
    });
  }

  if (reasoningActivities.length > 0) {
    reasoningActivities.forEach((event, index) => {
      const text = reasoningTexts[index] ?? reasoningTexts.join("\n\n");
      if (!text) return;
      rows.push({
        id: event.id,
        order: event.sequence,
        kind: "reasoning",
        event,
        text,
      });
    });
  } else {
    reasoningTexts.forEach((text, index) => {
      rows.push({
        id: `${message.id}:reasoning:${index}`,
        order: 200 + index,
        kind: "reasoning",
        text,
      });
    });
  }

  toolEntries.forEach((tool, index) => {
    rows.push({
      id: tool.id,
      order: tool.activity?.sequence ?? 500 + index,
      kind: "tool",
      tool,
    });
  });

  return rows.sort((a, b) => a.order - b.order);
}

export function groupTraceRowsByStep(
  _message: AntonUIMessage,
  rows: TraceRow[],
): StepGroup[] {
  const orderedRows = rows.toSorted((a, b) => a.order - b.order);
  const reasoningRows = orderedRows.filter((row) => row.kind === "reasoning");
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

  if (reasoningRows.length === 0) {
    addGroup(orderedRows.filter((row) => row.kind === "tool"));
    return groups;
  }

  addGroup(
    orderedRows.filter(
      (row) => row.kind === "tool" && row.order < reasoningRows[0].order,
    ),
  );

  reasoningRows.forEach((reasoningRow, index) => {
    const nextReasoningRow = reasoningRows[index + 1];
    addGroup(
      orderedRows.filter(
        (row) =>
          row.kind === "tool" &&
          row.order > reasoningRow.order &&
          (nextReasoningRow === undefined ||
            row.order < nextReasoningRow.order),
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

export function toolTitle(entry: ToolTraceEntry): {
  verb: string;
  target?: string;
} {
  const target = previewToolInput(entry.input);
  switch (entry.name) {
    case "bash":
      return { verb: "Ran", target };
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

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}
