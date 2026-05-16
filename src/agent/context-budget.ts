import type { AntonUIMessage } from "@/src/lib/trace";

import type { ContextBudgetAudit } from "./loop";
import type { RunBudget } from "./run-budget";

export type ContextBudgetReport = ContextBudgetAudit & {
  ok: boolean;
  reason?: "latest_user_too_large" | "required_context_too_large";
};

export type ContextBudgetResult =
  | {
      ok: true;
      messages: AntonUIMessage[];
      report: ContextBudgetReport;
    }
  | {
      ok: false;
      status: 413;
      error: string;
      report: ContextBudgetReport;
    };

export function budgetMessagesForModel({
  messages,
  budget,
  approvalContinuationMessageId,
  acceptedPlanMessageId,
  contextDigestBytes = 0,
}: {
  messages: AntonUIMessage[];
  budget: RunBudget;
  approvalContinuationMessageId?: string;
  acceptedPlanMessageId?: string;
  contextDigestBytes?: number;
}): ContextBudgetResult {
  const beforeBytes = utf8Bytes(stableJson(messages));
  const latestUserIndex = messages.findLastIndex((message) => message.role === "user");
  const latestUserBytes =
    latestUserIndex === -1 ? 0 : messageBytes(messages[latestUserIndex]);
  const requiredIndexes = requiredMessageIndexes({
    messages,
    latestUserIndex,
    approvalContinuationMessageId,
    acceptedPlanMessageId,
  });
  const requiredMessages = requiredIndexes.size;
  const baseReport = {
    beforeBytes,
    afterBytes: beforeBytes,
    maxInputBytes: budget.maxInputBytes,
    latestUserBytes,
    preservedMessages: messages.length,
    droppedMessages: 0,
    prunedMessages: 0,
    requiredMessages,
    contextDigestBytes,
  };

  if (latestUserBytes > budget.latestUserMaxBytes) {
    return {
      ok: false,
      status: 413,
      error:
        "Latest user message is too large for this run profile. Shorten the request or attach less context.",
      report: {
        ...baseReport,
        ok: false,
        reason: "latest_user_too_large",
      },
    };
  }

  const required = messages.filter((_, index) => requiredIndexes.has(index));
  const requiredBytes = utf8Bytes(stableJson(required));
  if (requiredBytes + contextDigestBytes > budget.maxInputBytes) {
    return {
      ok: false,
      status: 413,
      error:
        "Required conversation state is too large for this run profile. Start a new session or reduce the accepted plan/current request.",
      report: {
        ...baseReport,
        afterBytes: requiredBytes,
        preservedMessages: required.length,
        droppedMessages: messages.length - required.length,
        prunedMessages: messages.length - required.length,
        ok: false,
        reason: "required_context_too_large",
      },
    };
  }

  const selectedIndexes = new Set(requiredIndexes);
  let selectedBytes = requiredBytes;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (selectedIndexes.has(index)) continue;
    const nextBytes = messageBytes(messages[index]);
    if (selectedBytes + nextBytes + contextDigestBytes > budget.maxInputBytes) {
      break;
    }
    selectedIndexes.add(index);
    selectedBytes += nextBytes;
  }

  let selected = selectedMessages(messages, selectedIndexes);
  let afterBytes = utf8Bytes(stableJson(selected));
  while (afterBytes + contextDigestBytes > budget.maxInputBytes) {
    const dropIndex = firstRemovableIndex(selectedIndexes, requiredIndexes);
    if (dropIndex === undefined) break;
    selectedIndexes.delete(dropIndex);
    selected = selectedMessages(messages, selectedIndexes);
    afterBytes = utf8Bytes(stableJson(selected));
  }

  const droppedMessages = messages.length - selected.length;
  return {
    ok: true,
    messages: selected,
    report: {
      beforeBytes,
      afterBytes,
      maxInputBytes: budget.maxInputBytes,
      latestUserBytes,
      preservedMessages: selected.length,
      droppedMessages,
      prunedMessages: droppedMessages,
      requiredMessages,
      contextDigestBytes,
      ok: true,
    },
  };
}

function selectedMessages(
  messages: AntonUIMessage[],
  selectedIndexes: Set<number>,
): AntonUIMessage[] {
  return messages.filter((_, index) => selectedIndexes.has(index));
}

function firstRemovableIndex(
  selectedIndexes: Set<number>,
  requiredIndexes: Set<number>,
): number | undefined {
  return Array.from(selectedIndexes)
    .sort((left, right) => left - right)
    .find((index) => !requiredIndexes.has(index));
}

function requiredMessageIndexes({
  messages,
  latestUserIndex,
  approvalContinuationMessageId,
  acceptedPlanMessageId,
}: {
  messages: AntonUIMessage[];
  latestUserIndex: number;
  approvalContinuationMessageId?: string;
  acceptedPlanMessageId?: string;
}): Set<number> {
  const indexes = new Set<number>();
  if (latestUserIndex >= 0) indexes.add(latestUserIndex);
  for (const [index, message] of messages.entries()) {
    if (
      message.id === approvalContinuationMessageId ||
      message.id === acceptedPlanMessageId
    ) {
      indexes.add(index);
    }
  }
  return indexes;
}

function messageBytes(message: AntonUIMessage): number {
  return utf8Bytes(stableJson(message));
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
