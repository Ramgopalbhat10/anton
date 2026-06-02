import { getOpenRouterCatalog } from "@/src/lib/openrouter-catalog";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    catalog: await getOpenRouterCatalog(),
  });
}
