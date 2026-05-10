import { createHash } from "node:crypto";

import { z } from "zod";

import {
  preserveRedactedRecordValues,
  redactRecordSecrets,
  redactText,
} from "@/src/lib/redaction";

export const mcpTransportSchema = z.enum(["stdio", "http", "sse"]);
export type McpTransport = z.infer<typeof mcpTransportSchema>;

const stringRecordSchema = z.record(z.string(), z.string());

export const stdioMcpConfigSchema = z
  .object({
    type: z.literal("stdio"),
    command: z.string().trim().min(1),
    args: z.array(z.string()).default([]),
    env: stringRecordSchema.default({}),
    cwd: z.string().trim().min(1).optional(),
  })
  .strict();

export const remoteMcpConfigSchema = z
  .object({
    type: z.enum(["http", "sse"]).default("http"),
    url: z.string().url(),
    headers: stringRecordSchema.default({}),
    redirect: z.enum(["follow", "error"]).default("error"),
  })
  .strict();

export const mcpServerConfigSchema = z.union([
  stdioMcpConfigSchema,
  remoteMcpConfigSchema,
]);

export type StdioMcpConfig = z.infer<typeof stdioMcpConfigSchema>;
export type RemoteMcpConfig = z.infer<typeof remoteMcpConfigSchema>;
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

export type McpApprovalDetails = {
  title: string;
  summary: string;
  riskCategories: string[];
  details: string[];
  target: string;
};

export function normalizeMcpConfig(config: McpServerConfig): McpServerConfig {
  if (config.type === "stdio") {
    return {
      type: "stdio",
      command: config.command.trim(),
      args: [...(config.args ?? [])],
      env: sortedRecord(config.env ?? {}),
      ...(config.cwd ? { cwd: config.cwd.trim() } : {}),
    };
  }

  return {
    type: config.type,
    url: config.url,
    headers: sortedRecord(config.headers ?? {}),
    redirect: config.redirect ?? "error",
  };
}

export function redactMcpConfig(config: McpServerConfig): McpServerConfig {
  if (config.type === "stdio") {
    return {
      ...config,
      args: config.args.map(redactText),
      env: redactRecordSecrets(config.env),
      ...(config.cwd ? { cwd: redactText(config.cwd) } : {}),
    };
  }

  return {
    ...config,
    url: redactText(config.url),
    headers: redactRecordSecrets(config.headers),
  };
}

export function preserveRedactedMcpConfigValues(
  next: McpServerConfig,
  current: McpServerConfig,
): McpServerConfig {
  if (next.type === "stdio" && current.type === "stdio") {
    return {
      ...next,
      env: preserveRedactedRecordValues(next.env, current.env),
    };
  }
  if (next.type !== "stdio" && current.type !== "stdio") {
    return {
      ...next,
      headers: preserveRedactedRecordValues(next.headers, current.headers),
    };
  }
  return next;
}

export function fingerprintMcpConfig(config: McpServerConfig): string {
  const stable = stableJson(normalizeMcpConfig(config));
  return createHash("sha256").update(stable).digest("hex");
}

export function makeMcpApprovalDetails({
  displayName,
  config,
}: {
  displayName: string;
  config: McpServerConfig;
}): McpApprovalDetails {
  const normalized = normalizeMcpConfig(config);
  if (normalized.type === "stdio") {
    const envKeys = Object.keys(normalized.env);
    return {
      title: `Trust local MCP server "${displayName}"`,
      summary:
        "Allows Anton to start this local stdio MCP command and list its tools.",
      riskCategories: ["external-integration", "long-running-process"],
      target: normalized.command,
      details: [
        `Command: ${redactText(normalized.command)}`,
        `Args: ${normalized.args.length > 0 ? redactText(normalized.args.join(" ")) : "none"}`,
        `Working directory: ${normalized.cwd ? redactText(normalized.cwd) : "workspace root"}`,
        `Environment keys: ${envKeys.length > 0 ? envKeys.join(", ") : "none"}`,
        "Trust only allows server startup; individual MCP tool calls still require approval.",
      ],
    };
  }

  const headerKeys = Object.keys(normalized.headers);
  return {
    title: `Trust hosted MCP server "${displayName}"`,
    summary:
      "Allows Anton to connect to this hosted MCP endpoint and list its tools.",
    riskCategories: ["external-integration", "network"],
    target: normalized.url,
    details: [
      `Transport: ${normalized.type.toUpperCase()}`,
      `URL: ${redactText(normalized.url)}`,
      `Headers: ${headerKeys.length > 0 ? headerKeys.join(", ") : "none"}`,
      `Redirect mode: ${normalized.redirect}`,
      "Trust only allows server connection; individual MCP tool calls still require approval.",
    ],
  };
}

export function namespaceFromDisplayName(displayName: string): string {
  const normalized = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "mcp_server";
}

export function summarizeMcpConfig(config: McpServerConfig): string {
  if (config.type === "stdio") {
    return redactText([config.command, ...(config.args ?? [])].join(" "));
  }
  return redactText(config.url);
}

function sortedRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
