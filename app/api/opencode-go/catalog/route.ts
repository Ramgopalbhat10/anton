import { getOpenCodeGoCatalog } from "@/src/lib/opencode-go-catalog";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    catalog: await getOpenCodeGoCatalog(),
  });
}
