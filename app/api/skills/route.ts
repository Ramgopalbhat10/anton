import { listComposerSkills, listSkills } from "@/src/agent/skills";
import { getProject } from "@/src/db/queries";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("scope") === "composer") {
    const projectId = url.searchParams.get("projectId");
    const project = projectId ? getProject(projectId) : undefined;
    if (projectId && !project) {
      return Response.json({ error: "project not found" }, { status: 404 });
    }
    if (project && project.status !== "ready") {
      return Response.json({ error: "project is not ready" }, { status: 400 });
    }
    return Response.json(
      listComposerSkills(project?.localPath),
    );
  }

  try {
    return Response.json(listSkills());
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "skill discovery failed" },
      { status: 500 },
    );
  }
}
