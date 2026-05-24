import { getProject } from "@/src/db/queries";
import { serializeBackgroundCommandSession } from "@/src/lib/api-serializers";
import { redactText } from "@/src/lib/redaction";
import { getProjectBackgroundCommand } from "@/src/workspace/background-commands";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; commandId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, commandId } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }

  try {
    const session = getProjectBackgroundCommand(project.id, commandId);
    if (!session) {
      return Response.json({ error: "command session not found" }, { status: 404 });
    }
    return Response.json({ session: serializeBackgroundCommandSession(session) });
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
