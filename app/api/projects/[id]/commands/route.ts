import { getProject } from "@/src/db/queries";
import { serializeBackgroundCommandSession } from "@/src/lib/api-serializers";
import type { ProjectBackgroundCommandsSummary } from "@/src/lib/api-types";
import { redactText } from "@/src/lib/redaction";
import {
  clearProjectRecentBackgroundCommands,
  listProjectBackgroundCommands,
  startProjectBackgroundCommand,
} from "@/src/workspace/background-commands";
import { z } from "zod";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const startCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("script"),
    scriptName: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("custom"),
    command: z.string().trim().min(1),
  }),
]);

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  if (project.status !== "ready") {
    return Response.json({ error: "project is not ready" }, { status: 400 });
  }

  const listed = listProjectBackgroundCommands(project.id);
  const commands: ProjectBackgroundCommandsSummary = {
    running: listed.running.map(serializeBackgroundCommandSession),
    recent: listed.recent.map(serializeBackgroundCommandSession),
    runningCount: listed.runningCount,
  };
  return Response.json({ commands });
}

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

  const parsed = startCommandSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  try {
    const result = await startProjectBackgroundCommand(
      project.id,
      project.localPath,
      parsed.data,
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

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }

  try {
    const cleared = clearProjectRecentBackgroundCommands(project.id);
    return Response.json({ cleared });
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
