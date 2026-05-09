import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  createMCPClient,
  type MCPClient,
  type MCPClientConfig,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { ToolSet } from "ai";

import {
  isMcpServerTrusted,
  listEnabledMcpServers,
} from "@/src/db/queries";
import {
  mcpServerConfigSchema,
  normalizeMcpConfig,
  type McpServerConfig,
} from "./mcp-config";
import {
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
  resolveInWorkspace,
} from "./sandbox";

const MCP_CONFIG_FILE = ".mcp.json";
const MAX_MCP_CONFIG_BYTES = 256 * 1024;
const SAFE_NAME_RE = /^[A-Za-z0-9_-]+$/;

type McpToolSummary = {
  name: string;
  serverName: string;
  namespace: string;
  toolName: string;
  description: string;
};

export type LoadedMcpTools = {
  tools: ToolSet;
  toolSummaries: McpToolSummary[];
  warnings: string[];
  close: () => Promise<void>;
};

const workspaceStdioServerSchema = z
  .object({
    command: z.string().trim().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().trim().min(1).optional(),
  })
  .strict();

const workspaceHttpServerSchema = z
  .object({
    type: z.enum(["http", "sse"]).default("http"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    redirect: z.enum(["follow", "error"]).optional(),
  })
  .strict();

const mcpConfigSchema = z
  .object({
    mcpServers: z.record(
      z.string(),
      z.union([workspaceStdioServerSchema, workspaceHttpServerSchema]),
    ),
  })
  .strict();

type WorkspaceMcpServerConfig =
  | z.infer<typeof workspaceStdioServerSchema>
  | z.infer<typeof workspaceHttpServerSchema>;

type McpServerSpec = {
  id?: string;
  displayName: string;
  namespace: string;
  config: McpServerConfig;
  trusted: boolean;
  source: "global" | "workspace";
};

type ExecutableTool = ToolSet[string] & {
  description?: string;
  execute?: (input: unknown, options: never) => unknown;
};

export async function loadMcpTools({
  workspaceRoot,
  enabledMcpServerIds,
}: {
  workspaceRoot?: string;
  enabledMcpServerIds?: string[];
} = {}): Promise<LoadedMcpTools> {
  const tools: ToolSet = {};
  const toolSummaries: McpToolSummary[] = [];
  const workspaceConfig = readMcpConfig(workspaceRoot);
  const warnings: string[] = [...(workspaceConfig?.warnings ?? [])];
  const clients: MCPClient[] = [];
  const specs = [
    ...globalMcpServerSpecs(enabledMcpServerIds),
    ...(workspaceConfig ? workspaceMcpServerSpecs(workspaceConfig.servers) : []),
  ];

  if (specs.length === 0) {
    return emptyMcpTools(warnings);
  }

  for (const spec of specs) {
    if (!spec.trusted) {
      warnings.push(
        `skipping untrusted MCP server ${spec.displayName}; approve it in Settings before use`,
      );
      continue;
    }

    try {
      const client = await createMCPClient({
        transport: transportForServer(spec.config, workspaceRoot),
        name: "anton",
        version: "0.1.0",
        onUncaughtError: (err) => {
          warnings.push(`MCP server ${spec.displayName} error: ${errorMessage(err)}`);
        },
      });
      clients.push(client);

      const serverTools = await client.tools();
      for (const [toolName, mcpTool] of Object.entries(serverTools)) {
        const safeToolName = safeNamespace(toolName);
        if (!isSafeName(safeToolName)) {
          warnings.push(
            `skipping MCP tool with invalid name: ${spec.displayName}/${toolName}`,
          );
          continue;
        }

        const exposedName = `mcp__${spec.namespace}__${safeToolName}`;
        if (tools[exposedName]) {
          warnings.push(`skipping duplicate MCP tool name: ${exposedName}`);
          continue;
        }

        tools[exposedName] = wrapMcpTool(spec.displayName, toolName, mcpTool);
        toolSummaries.push({
          name: exposedName,
          serverName: spec.displayName,
          namespace: spec.namespace,
          toolName,
          description:
            typeof mcpTool.description === "string" ? mcpTool.description : "",
        });
      }
    } catch (err) {
      warnings.push(`failed to load MCP server ${spec.displayName}: ${errorMessage(err)}`);
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

export function readMcpConfig(
  workspaceRoot?: string,
):
  | { servers: Record<string, WorkspaceMcpServerConfig>; warnings: string[] }
  | null {
  const configPath = resolveInWorkspace(MCP_CONFIG_FILE, workspaceRoot);
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

function emptyMcpTools(warnings: string[] = []): LoadedMcpTools {
  return {
    tools: {},
    toolSummaries: [],
    warnings,
    close: async () => {},
  };
}

function transportForServer(
  config: McpServerConfig,
  workspaceRoot?: string,
): MCPClientConfig["transport"] {
  const normalized = normalizeMcpConfig(config);
  if (normalized.type === "stdio") {
    const root = workspaceRoot
      ? ensureWorkspaceRootAt(workspaceRoot)
      : ensureWorkspaceRoot();
    return new Experimental_StdioMCPTransport({
      command: normalized.command,
      args: normalized.args,
      env: normalized.env,
      cwd: normalized.cwd ? resolveMcpCwd(normalized.cwd, root) : root,
    });
  }

  return {
    type: normalized.type,
    url: normalized.url,
    headers: normalized.headers,
    redirect: normalized.redirect,
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

function globalMcpServerSpecs(enabledMcpServerIds?: string[]): McpServerSpec[] {
  return listEnabledMcpServers(enabledMcpServerIds).flatMap((server) => {
    const parsed = mcpServerConfigSchema.safeParse(server.config);
    if (!parsed.success) return [];
    return [
      {
        id: server.id,
        displayName: server.displayName,
        namespace: server.namespace,
        config: parsed.data,
        trusted: isMcpServerTrusted(server),
        source: "global" as const,
      },
    ];
  });
}

function workspaceMcpServerSpecs(
  servers: Record<string, WorkspaceMcpServerConfig>,
): McpServerSpec[] {
  return Object.entries(servers).map(([displayName, serverConfig]) => {
    const config: McpServerConfig =
      "command" in serverConfig
        ? {
            type: "stdio",
            command: serverConfig.command,
            args: serverConfig.args ?? [],
            env: serverConfig.env ?? {},
            ...(serverConfig.cwd ? { cwd: serverConfig.cwd } : {}),
          }
        : {
            type: serverConfig.type ?? "http",
            url: serverConfig.url,
            headers: serverConfig.headers ?? {},
            redirect: serverConfig.redirect ?? "error",
          };

    return {
      displayName,
      namespace: safeNamespace(displayName),
      config,
      trusted: false,
      source: "workspace" as const,
    };
  });
}

function safeNamespace(name: string): string {
  const safe = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe.length > 0 ? safe : "mcp";
}

function resolveMcpCwd(cwd: string, workspaceRoot: string): string {
  return path.isAbsolute(cwd) ? path.resolve(cwd) : resolveInWorkspace(cwd, workspaceRoot);
}

function isSafeName(name: string): boolean {
  return SAFE_NAME_RE.test(name);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
