import { listSkills } from "@/src/agent/skills";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(listSkills());
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "skill discovery failed" },
      { status: 500 },
    );
  }
}
