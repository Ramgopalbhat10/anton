import { z } from "zod";

import { ensureWorkspaceRootAt } from "@/src/agent/sandbox";
import {
  getProject,
  updateProjectEnvironmentEnabled,
} from "@/src/db/queries";
import {
  patchProjectEnvironment,
  ProjectEnvironmentError,
  summarizeProjectEnvironment,
} from "@/src/workspace/project-env";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const keySchema = z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
const patchSchema = z.object({
  enabled: z.boolean().optional(),
  upsert: z
    .array(
      z.object({
        key: keySchema,
        value: z.string().max(64 * 1024),
      }),
    )
    .max(100)
    .optional(),
  delete: z.array(keySchema).max(100).optional(),
});

export async function GET(_req: Request, { params }: Ctx) {
  const ready = await readyProject(params);
  if ("error" in ready) return ready.error;

  try {
    return Response.json({
      environment: await summarizeProjectEnvironment({
        projectId: ready.project.id,
        root: ready.root,
        enabled: ready.project.environmentEnabled,
      }),
    });
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const ready = await readyProject(params);
  if ("error" in ready) return ready.error;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const upsertCount = parsed.data.upsert?.length ?? 0;
    const deleteCount = parsed.data.delete?.length ?? 0;
    if (upsertCount > 0 || deleteCount > 0) {
      await patchProjectEnvironment(ready.root, parsed.data);
    }

    const enabled =
      parsed.data.enabled ??
      (upsertCount > 0 ? true : ready.project.environmentEnabled);
    const project =
      enabled === ready.project.environmentEnabled
        ? ready.project
        : updateProjectEnvironmentEnabled(ready.project.id, enabled) ?? ready.project;

    return Response.json({
      environment: await summarizeProjectEnvironment({
        projectId: project.id,
        root: ready.root,
        enabled: project.environmentEnabled,
      }),
    });
  } catch (err) {
    const status = err instanceof ProjectEnvironmentError ? err.status : 500;
    return Response.json({ error: errorMessage(err) }, { status });
  }
}

async function readyProject(params: Promise<{ id: string }>): Promise<
  | { project: NonNullable<ReturnType<typeof getProject>>; root: string }
  | { error: Response }
> {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return { error: Response.json({ error: "project not found" }, { status: 404 }) };
  }
  if (project.status !== "ready") {
    return { error: Response.json({ error: "project is not ready" }, { status: 400 }) };
  }
  return { project, root: ensureWorkspaceRootAt(project.localPath) };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
