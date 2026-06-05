import { getProject, getWorkspaceSettings } from "@/src/db/queries";
import { redactText } from "@/src/lib/redaction";
import { preflightProjectBackgroundCommand } from "@/src/workspace/background-commands";
import { z } from "zod";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const preflightSchema = z.object({
  command: z.string().trim().min(1),
});

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  if (project.status !== "ready") {
    return Response.json({ error: "project is not ready" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = preflightSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  try {
    const permissionMode =
      getWorkspaceSettings().defaultPermissionMode ?? "auto-review";
    const result = preflightProjectBackgroundCommand(
      project.localPath,
      parsed.data.command,
      permissionMode,
    );
    if (!result.ok) {
      return Response.json(
        { error: result.error },
        { status: result.status ?? 400 },
      );
    }

    return Response.json({
      allowed: result.allowed,
      risky: result.risky,
      categories: result.categories,
      commandPolicyMode: result.commandPolicyMode,
      reason: result.reason,
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
