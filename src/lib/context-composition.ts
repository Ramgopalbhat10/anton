import type { ToolSet } from "ai";

export const CONTEXT_BYTES_PER_TOKEN = 4;

export type ContextCompositionAudit = {
  systemPromptTokens: number;
  stableContextTokens: number;
  toolDefinitionsTokens: number;
  memoryTokens: number;
  skillsTokens: number;
  mcpPromptTokens: number;
  runProfileTokens: number;
  priorRunContextTokens: number;
  conversationTokens: number;
  source: "estimated";
};

export type ContextCompositionSection = {
  key: string;
  label: string;
  tokens: number;
};

export function estimateTokensFromText(text: string): number {
  return estimateTokensFromBytes(Buffer.byteLength(text, "utf8"));
}

export function estimateTokensFromBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.max(1, Math.round(bytes / CONTEXT_BYTES_PER_TOKEN));
}

export function estimateToolDefinitionsTokens(tools: ToolSet): number {
  const payload = Object.entries(tools).map(([name, tool]) => ({
    name,
    description:
      typeof tool.description === "string" ? tool.description : undefined,
  }));
  return estimateTokensFromText(JSON.stringify(payload));
}

export function contextCompositionSections(
  composition: ContextCompositionAudit,
): ContextCompositionSection[] {
  return [
    { key: "system", label: "System prompt", tokens: composition.systemPromptTokens },
    {
      key: "stable",
      label: "Stable run context",
      tokens: composition.stableContextTokens,
    },
    {
      key: "tools",
      label: "Tool definitions",
      tokens: composition.toolDefinitionsTokens,
    },
    { key: "memory", label: "Memory", tokens: composition.memoryTokens },
    { key: "skills", label: "Skills", tokens: composition.skillsTokens },
    { key: "mcp", label: "MCP", tokens: composition.mcpPromptTokens },
    {
      key: "profile",
      label: "Run profile",
      tokens: composition.runProfileTokens,
    },
    {
      key: "prior-context",
      label: "Prior run context",
      tokens: composition.priorRunContextTokens,
    },
    {
      key: "conversation",
      label: "Conversation",
      tokens: composition.conversationTokens,
    },
  ].filter((section) => section.tokens > 0);
}

export function contextCompositionTotalTokens(
  composition: ContextCompositionAudit,
): number {
  return contextCompositionSections(composition).reduce(
    (sum, section) => sum + section.tokens,
    0,
  );
}
