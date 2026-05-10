import { listEnabledMcpServers } from "@/src/db/queries";
import { serializeMcpServer } from "@/src/lib/api-serializers";
import { mcpServerIdsSchema } from "@/src/lib/mcp-api";
import type { McpPreflightServer } from "@/src/lib/api-types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = mcpServerIdsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const servers = listEnabledMcpServers(parsed.data.serverIds).map(serializeMcpServer);
  const untrusted: McpPreflightServer[] = servers
    .filter((server) => !server.trust.trusted)
    .map((server) => ({
      id: server.id,
      displayName: server.displayName,
      namespace: server.namespace,
      transport: server.transport,
      summary: server.summary,
      trust: server.trust,
    }));

  return Response.json({
    ok: untrusted.length === 0,
    untrusted,
  });
}
