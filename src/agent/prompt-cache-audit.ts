import { createHash } from "node:crypto";
import type { ModelMessage, ToolSet } from "ai";

import type { TokenUsageMetrics } from "@/src/lib/token-usage";

export type PromptCacheAudit = {
  modelId: string;
  providerId: string;
  systemPromptHash: string;
  toolSchemaHash: string;
  nativeToolNamesHash: string;
  mcpToolNamesHash: string;
  workspaceContextHash: string;
  messagePrefixHash: string;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  cacheHitRate?: number;
  likelyCacheMissReasons: string[];
  cacheBreakReasons: string[];
};

export function buildPromptCacheAudit({
  modelId,
  system,
  tools,
  nativeToolNames,
  mcpToolNames,
  activeToolNames,
  workspaceContextText,
  messages,
  tokenUsage,
  previousAudit,
}: {
  modelId: string;
  system: string;
  tools: ToolSet;
  nativeToolNames: readonly string[];
  mcpToolNames: readonly string[];
  activeToolNames?: readonly string[];
  workspaceContextText: string;
  messages: ModelMessage[];
  tokenUsage?: TokenUsageMetrics;
  previousAudit?: PromptCacheAudit | null;
}): PromptCacheAudit {
  const cachedInputTokens = tokenUsage?.cachedInputTokens;
  const cacheWriteTokens = tokenUsage?.cacheWriteTokens;
  const rawInputTokens = tokenUsage?.rawInputTokens;
  const cacheHitRate =
    rawInputTokens !== undefined &&
    rawInputTokens > 0 &&
    cachedInputTokens !== undefined
      ? cachedInputTokens / rawInputTokens
      : undefined;

  const likelyCacheMissReasons = likelyCacheMissReasonsFor({
    cacheHitRate,
    cacheWriteTokens,
    workspaceContextText,
    messageCount: messages.length,
  });

  const auditBase = {
    modelId,
    providerId: "openrouter",
    systemPromptHash: hashText(system),
    toolSchemaHash: hashText(stableJson(toolSchemas(tools, activeToolNames))),
    nativeToolNamesHash: hashText((activeToolNames ?? nativeToolNames).join("\n")),
    mcpToolNamesHash: hashText(mcpToolNames.join("\n")),
    workspaceContextHash: hashText(workspaceContextText),
    messagePrefixHash: hashText(stableJson(messagePrefix(messages))),
  };

  const cacheBreakReasons = comparePromptCacheAudit(previousAudit ?? undefined, auditBase);

  return {
    ...auditBase,
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(cacheHitRate !== undefined ? { cacheHitRate } : {}),
    likelyCacheMissReasons,
    cacheBreakReasons,
  };
}

export function comparePromptCacheAudit(
  previous: Pick<
    PromptCacheAudit,
    | "modelId"
    | "providerId"
    | "systemPromptHash"
    | "toolSchemaHash"
    | "nativeToolNamesHash"
    | "mcpToolNamesHash"
    | "workspaceContextHash"
    | "messagePrefixHash"
  > | undefined,
  current: Pick<
    PromptCacheAudit,
    | "modelId"
    | "providerId"
    | "systemPromptHash"
    | "toolSchemaHash"
    | "nativeToolNamesHash"
    | "mcpToolNamesHash"
    | "workspaceContextHash"
    | "messagePrefixHash"
  >,
): string[] {
  if (!previous) return [];
  const reasons: string[] = [];
  if (previous.modelId !== current.modelId) {
    reasons.push("model id changed from the previous run in this session");
  }
  if (previous.providerId !== current.providerId) {
    reasons.push("provider id changed from the previous run in this session");
  }
  if (previous.systemPromptHash !== current.systemPromptHash) {
    reasons.push("system prompt hash changed");
  }
  if (previous.toolSchemaHash !== current.toolSchemaHash) {
    reasons.push("tool schema hash changed");
  }
  if (previous.nativeToolNamesHash !== current.nativeToolNamesHash) {
    reasons.push("native tool set hash changed");
  }
  if (previous.mcpToolNamesHash !== current.mcpToolNamesHash) {
    reasons.push("MCP tool set hash changed");
  }
  if (previous.workspaceContextHash !== current.workspaceContextHash) {
    reasons.push("workspace/session context hash changed");
  }
  if (previous.messagePrefixHash !== current.messagePrefixHash) {
    reasons.push("message prefix hash changed");
  }
  return reasons;
}

export function promptCacheAuditFromCostMetadata(
  costMetadata: unknown,
): PromptCacheAudit | undefined {
  if (!isRecord(costMetadata)) return undefined;
  const tokenAudit = isRecord(costMetadata.tokenAudit)
    ? costMetadata.tokenAudit
    : undefined;
  const promptCache = tokenAudit && isRecord(tokenAudit.promptCache)
    ? tokenAudit.promptCache
    : undefined;
  if (!promptCache) return undefined;
  const modelId = stringValue(promptCache.modelId);
  const providerId = stringValue(promptCache.providerId);
  if (!modelId || !providerId) return undefined;
  return {
    modelId,
    providerId,
    systemPromptHash: stringValue(promptCache.systemPromptHash) ?? "—",
    toolSchemaHash: stringValue(promptCache.toolSchemaHash) ?? "—",
    nativeToolNamesHash: stringValue(promptCache.nativeToolNamesHash) ?? "—",
    mcpToolNamesHash: stringValue(promptCache.mcpToolNamesHash) ?? "—",
    workspaceContextHash: stringValue(promptCache.workspaceContextHash) ?? "—",
    messagePrefixHash: stringValue(promptCache.messagePrefixHash) ?? "—",
    likelyCacheMissReasons: stringArray(promptCache.likelyCacheMissReasons),
    cacheBreakReasons: stringArray(promptCache.cacheBreakReasons),
    ...(finiteNumber(promptCache.cachedInputTokens) !== undefined
      ? { cachedInputTokens: finiteNumber(promptCache.cachedInputTokens) }
      : {}),
    ...(finiteNumber(promptCache.cacheWriteTokens) !== undefined
      ? { cacheWriteTokens: finiteNumber(promptCache.cacheWriteTokens) }
      : {}),
    ...(finiteNumber(promptCache.cacheHitRate) !== undefined
      ? { cacheHitRate: finiteNumber(promptCache.cacheHitRate) }
      : {}),
  };
}

function likelyCacheMissReasonsFor(input: {
  cacheHitRate: number | undefined;
  cacheWriteTokens: number | undefined;
  workspaceContextText: string;
  messageCount: number;
}): string[] {
  const reasons: string[] = [];
  if (input.cacheWriteTokens !== undefined && input.cacheWriteTokens > 0) {
    reasons.push("provider reported cache write tokens on this run");
  }
  if (input.workspaceContextText.trim().length > 0) {
    reasons.push("dynamic workspace/session context precedes the latest user turn");
  }
  if (input.messageCount > 4) {
    reasons.push("conversation prefix grew beyond the initial stable prompt block");
  }
  if (input.cacheHitRate !== undefined && input.cacheHitRate < 0.2) {
    reasons.push("low cache hit rate for provider-reported input tokens");
  }
  return reasons;
}

function toolSchemas(
  tools: ToolSet,
  activeToolNames: readonly string[] | undefined,
): unknown {
  const activeSet = activeToolNames ? new Set(activeToolNames) : undefined;
  return Object.fromEntries(
    Object.keys(tools)
      .filter((name) => !activeSet || activeSet.has(name))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => {
        const toolValue = tools[name];
        return [
          name,
          {
            description:
              typeof toolValue === "object" &&
              toolValue !== null &&
              "description" in toolValue
                ? toolValue.description
                : undefined,
            inputSchema:
              typeof toolValue === "object" &&
              toolValue !== null &&
              "inputSchema" in toolValue
                ? toolValue.inputSchema
                : undefined,
          },
        ];
      }),
  );
}

function messagePrefix(messages: ModelMessage[]): unknown {
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  if (latestUserIndex <= 0) return messages.slice(0, 1);
  return messages.slice(0, latestUserIndex);
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === "string" ? [item] : []));
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
