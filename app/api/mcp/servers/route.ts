import { createMcpServer, listMcpServers } from "@/src/db/queries";
import { serializeMcpServer } from "@/src/lib/api-serializers";
import { mcpServerInputSchema } from "@/src/lib/mcp-api";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    servers: listMcpServers().map(serializeMcpServer),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = mcpServerInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const server = createMcpServer(parsed.data);
  return Response.json({ server: serializeMcpServer(server) }, { status: 201 });
}
