import { listSessions } from "@/src/db/queries";

export const runtime = "nodejs";

export async function GET() {
  const rows = listSessions();
  return Response.json({
    sessions: rows.map((s) => ({
      id: s.id,
      title: s.title,
      model: s.model,
      tokensTotal: s.tokensTotal,
      createdAt: s.createdAt.getTime(),
      updatedAt: s.updatedAt.getTime(),
    })),
  });
}
