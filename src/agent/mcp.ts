import fs from "node:fs";
import { z } from "zod";
import {
  createMCPClient,
  type MCPClient,
  type MCPClientConfig,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { ToolSet } from "ai";

import { ensureWorkspaceRoot, resolveInWorkspace } from "./sandbox";

const MCP_CONFIG_FILE = ".mcp.json";
const MAX_MCP_CONFIG_BYTES = 256 * 1024;
const SAFE_NAME_RE = /^[A-Za-z0-9_-]+$/;

type McpToolSummary = {
  name: string;
  serverName: string;
  toolName: string;
  description: string;
};

export type LoadedMcpTools = {
  tools: ToolSet;
  toolSummaries: McpToolSummary[];
  warnings: string[];
  close: () => Promise<void>;
};

const stdioServerSchema = z
  .object({
    command: z.string().trim().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().trim().min(1).optional(),
  })
  .strict();

const httpServerSchema = z
  .object({
    type: z.enum(["http", "sse"]).default("http"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    redirect: z.enum(["follow", "error"]).optional(),
  })
  .strict();

const mcpConfigSchema = z
  .object({
    mcpServers: z.record(z.string(), z.union([stdioServerSchema, httpServerSchema])),
  })
  .strict();

type McpServerConfig = z.infer<typeof stdioServerSchema> | z.infer<typeof httpServerSchema>;

type ExecutableTool = ToolSet[string] & {
  description?: string;
  execute?: (input: unknown, options: never) => unknown;
};

export async function loadMcpTools(): Promise<LoadedMcpTools> {
  const config = readMcpConfig();
  if (!config) {
    return emptyMcpTools();
  }

  const tools: ToolSet = {};
  const toolSummaries: McpToolSummary[] = [];
  const warnings: string[] = [...config.warnings];
  const clients: MCPClient[] = [];

  for (const [serverName, serverConfig] of Object.entries(config.servers)) {
    if (!isSafeName(serverName)) {
      warnings.push(`skipping MCP server with invalid name: ${serverName}`);
      continue;
    }

    try {
      const client = await createMCPClient({
        transport: transportForServer(serverConfig),
        name: "anton",
        version: "0.1.0",
        onUncaughtError: (err) => {
          warnings.push(`MCP server ${serverName} error: ${errorMessage(err)}`);
        },
      });
      clients.push(client);

      const serverTools = await client.tools();
      for (const [toolName, mcpTool] of Object.entries(serverTools)) {
        if (!isSafeName(toolName)) {
          warnings.push(
            `skipping MCP tool with invalid name: ${serverName}/${toolName}`,
          );
          continue;
        }

        const exposedName = `mcp__${serverName}__${toolName}`;
        if (tools[exposedName]) {
          warnings.push(`skipping duplicate MCP tool name: ${exposedName}`);
          continue;
        }

        tools[exposedName] = wrapMcpTool(serverName, toolName, mcpTool);
        toolSummaries.push({
          name: exposedName,
          serverName,
          toolName,
          description:
            typeof mcpTool.description === "string" ? mcpTool.description : "",
        });
      }
    } catch (err) {
      warnings.push(`failed to load MCP server ${serverName}: ${errorMessage(err)}`);
    }
  }

  return {
    tools,
    toolSummaries,
    warnings,
    close: async () => {
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
}

function readMcpConfig():
  | { servers: Record<string, McpServerConfig>; warnings: string[] }
  | null {
  const configPath = resolveInWorkspace(MCP_CONFIG_FILE);
  if (!fs.existsSync(configPath)) return null;

  const stat = fs.statSync(configPath);
  if (!stat.isFile()) {
    return {
      servers: {},
      warnings: [`${MCP_CONFIG_FILE} exists but is not a file`],
    };
  }
  if (stat.size > MAX_MCP_CONFIG_BYTES) {
    return {
      servers: {},
      warnings: [
        `${MCP_CONFIG_FILE} is too large (${stat.size} bytes, cap ${MAX_MCP_CONFIG_BYTES})`,
      ],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    return {
      servers: {},
      warnings: [`failed to parse ${MCP_CONFIG_FILE}: ${errorMessage(err)}`],
    };
  }

  const parsed = mcpConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      servers: {},
      warnings: [
        `invalid ${MCP_CONFIG_FILE}: ${parsed.error.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      ],
    };
  }

  return { servers: parsed.data.mcpServers, warnings: [] };
}

function emptyMcpTools(): LoadedMcpTools {
  return {
    tools: {},
    toolSummaries: [],
    warnings: [],
    close: async () => {},
  };
}

function transportForServer(config: McpServerConfig): MCPClientConfig["transport"] {
  if ("command" in config) {
    return new Experimental_StdioMCPTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd ? resolveInWorkspace(config.cwd) : ensureWorkspaceRoot(),
    });
  }

  return {
    type: config.type,
    url: config.url,
    headers: config.headers,
    redirect: config.redirect ?? "error",
  };
}

function wrapMcpTool(
  serverName: string,
  toolName: string,
  toolValue: unknown,
): ToolSet[string] {
  const mcpTool = toolValue as ExecutableTool;
  if (typeof mcpTool.execute !== "function") {
    throw new Error(`MCP tool ${serverName}/${toolName} has no execute function`);
  }

  return {
    ...mcpTool,
    description: `[MCP:${serverName}] ${mcpTool.description ?? toolName}`,
    needsApproval: true,
    execute: async (input: unknown, options: never) => {
      try {
        const output = await mcpTool.execute?.(input, options);
        return { ok: true as const, output };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  } as ToolSet[string];
}

function isSafeName(name: string): boolean {
  return SAFE_NAME_RE.test(name);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
