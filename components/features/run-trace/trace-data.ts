import {
  getActivityEvents,
  getReasoningTexts,
  getToolTraceEntries,
  type AntonActivityEvent,
  type AntonUIMessage,
  type ToolTraceEntry,
} from "@/src/lib/trace";

import { previewToolInput } from "./tool-display";

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
