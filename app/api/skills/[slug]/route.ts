import { readSkill } from "@/src/agent/skills";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  try {
    return Response.json({ skill: readSkill(slug) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "skill not found" },
      { status: 404 },
    );
  }
}
