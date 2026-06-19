import { getOpenCodeGoCatalog } from "@/src/lib/opencode-go-catalog";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  return Response.json({
    catalog: await getOpenCodeGoCatalog({ refresh }),
  });
}
