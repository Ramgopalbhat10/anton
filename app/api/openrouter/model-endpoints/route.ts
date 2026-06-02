import { getOpenRouterModelEndpoints } from "@/src/lib/openrouter-catalog";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const model = url.searchParams.get("model")?.trim();
  if (!model) {
    return Response.json({ error: "model is required" }, { status: 400 });
  }

  return Response.json({
    endpoints: await getOpenRouterModelEndpoints(model),
  });
}
