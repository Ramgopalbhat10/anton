import { loadMcpTools } from "@/src/agent/mcp";
import {
  getMcpServer,
  isMcpServerTrusted,
  updateMcpServerStatus,
} from "@/src/db/queries";
import { serializeMcpServer } from "@/src/lib/api-serializers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const server = getMcpServer(id);
  if (!server) {
    return Response.json({ error: "MCP server not found" }, { status: 404 });
  }

  const serialized = serializeMcpServer(server);
  if (!isMcpServerTrusted(server)) {
    return Response.json(
      {
        error: "MCP server trust approval required before connection test",
        requiresTrust: serialized.trust,
      },
      { status: 409 },
    );
  }

  const loaded = await loadMcpTools({ enabledMcpServerIds: [id] });
  try {
    const failedWarning = loaded.warnings.find((warning) =>
      warning.includes(server.displayName),
    );
    if (failedWarning) {
      const updated = updateMcpServerStatus(id, "error", failedWarning) ?? server;
      return Response.json(
        {
          error: failedWarning,
          server: serializeMcpServer(updated),
          warnings: loaded.warnings,
          tools: loaded.toolSummaries,
        },
        { status: 502 },
      );
    }

    const updated = updateMcpServerStatus(id, "ok", null) ?? server;
    return Response.json({
      server: serializeMcpServer(updated),
      warnings: loaded.warnings,
      tools: loaded.toolSummaries,
    });
  } finally {
    await loaded.close();
  }
}
