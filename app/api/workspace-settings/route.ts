import { z } from "zod";

import { getWorkspaceSettings } from "@/src/db/queries";
import {
  getLocalWorkspacesRoot,
  setLocalWorkspacesRoot,
  WorkspaceRootError,
} from "@/src/workspace/local";

export const runtime = "nodejs";

const patchSchema = z.object({
  localWorkspacesRoot: z.string().trim().min(1).nullable(),
});

export async function GET() {
  return Response.json({
    settings: serializeSettings(),
  });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    await setLocalWorkspacesRoot(parsed.data.localWorkspacesRoot);
    return Response.json({ settings: serializeSettings() });
  } catch (err) {
    const status = err instanceof WorkspaceRootError ? 400 : 500;
    return Response.json({ error: errorMessage(err) }, { status });
  }
}

function serializeSettings() {
  const settings = getWorkspaceSettings();
  const resolved = getLocalWorkspacesRoot();
  return {
    localWorkspacesRoot: settings.localWorkspacesRoot,
    resolvedLocalWorkspacesRoot: resolved.path,
    source: resolved.source,
    exists: resolved.exists,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
