import { getProject, getWorkspaceSettings } from "@/src/db/queries";
import { serializeBackgroundCommandSession } from "@/src/lib/api-serializers";
import { redactText } from "@/src/lib/redaction";
import { restartProjectBackgroundCommand } from "@/src/workspace/background-commands";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; commandId: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id, commandId } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  if (project.status !== "ready") {
    return Response.json({ error: "project is not ready" }, { status: 400 });
  }

  try {
    const permissionMode =
      getWorkspaceSettings().defaultPermissionMode ?? "auto-review";
    const result = await restartProjectBackgroundCommand(
      project.id,
      commandId,
      project.localPath,
      permissionMode,
    );
    if (!result.ok) {
      return Response.json(
        { error: result.error },
        { status: result.status ?? 400 },
      );
    }
    return Response.json({
      session: serializeBackgroundCommandSession(result.session),
      streamToken: result.streamToken,
    });
  } catch (err) {
    return Response.json(
      { error: redactText(errorMessage(err)) },
      { status: 500 },
    );
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
