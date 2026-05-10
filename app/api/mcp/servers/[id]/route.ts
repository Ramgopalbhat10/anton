import {
  deleteMcpServer,
  getMcpServer,
  updateMcpServer,
} from "@/src/db/queries";
import { serializeMcpServer } from "@/src/lib/api-serializers";
import { mcpServerPatchSchema } from "@/src/lib/mcp-api";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const server = getMcpServer(id);
  if (!server) {
    return Response.json({ error: "MCP server not found" }, { status: 404 });
  }
  return Response.json({ server: serializeMcpServer(server) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = mcpServerPatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const server = updateMcpServer(id, parsed.data);
  if (!server) {
    return Response.json({ error: "MCP server not found" }, { status: 404 });
  }
  return Response.json({ server: serializeMcpServer(server) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!deleteMcpServer(id)) {
    return Response.json({ error: "MCP server not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
