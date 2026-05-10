import {
  fingerprintMcpConfig,
  type McpServerConfig,
} from "@/src/agent/mcp-config";
import {
  getMcpServer,
  upsertMcpTrustDecision,
} from "@/src/db/queries";
import { serializeMcpServer } from "@/src/lib/api-serializers";
import { mcpTrustInputSchema } from "@/src/lib/mcp-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = mcpTrustInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const server = getMcpServer(parsed.data.serverId);
  if (!server) {
    return Response.json({ error: "MCP server not found" }, { status: 404 });
  }
  const currentFingerprint = fingerprintMcpConfig(server.config as McpServerConfig);
  if (parsed.data.fingerprint !== currentFingerprint) {
    return Response.json(
      { error: "MCP server config changed; refresh trust details" },
      { status: 409 },
    );
  }

  upsertMcpTrustDecision({
    mcpServerId: server.id,
    fingerprint: parsed.data.fingerprint,
    decision: parsed.data.approved ? "approved" : "denied",
  });

  return Response.json({ server: serializeMcpServer(server) });
}
