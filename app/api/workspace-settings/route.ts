import { z } from "zod";

import { getWorkspaceSettings, updateWorkspaceSettings } from "@/src/db/queries";
import { isSupportedModelId, resolveModelId } from "@/src/lib/models";
import {
  getLocalWorkspacesRoot,
  setLocalWorkspacesRoot,
  WorkspaceRootError,
} from "@/src/workspace/local";

export const runtime = "nodejs";

const permissionModeSchema = z.enum(["default", "auto-review", "full-access"]);

const patchSchema = z.object({
  localWorkspacesRoot: z.string().trim().min(1).nullable().optional(),
  defaultModel: z.string().trim().min(1).nullable().optional(),
  defaultMaxSteps: z.number().int().min(1).max(64).nullable().optional(),
  defaultPermissionMode: permissionModeSchema.nullable().optional(),
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

  if (
    parsed.data.defaultModel !== undefined &&
    parsed.data.defaultModel !== null &&
    !isSupportedModelId(parsed.data.defaultModel)
  ) {
    return Response.json(
      { error: "unsupported model", model: parsed.data.defaultModel },
      { status: 400 },
    );
  }

  try {
    if ("localWorkspacesRoot" in parsed.data) {
      await setLocalWorkspacesRoot(parsed.data.localWorkspacesRoot ?? null);
    }
    const agentPatch = {
      ...(parsed.data.defaultModel !== undefined
        ? {
            defaultModel:
              parsed.data.defaultModel === null
                ? null
                : resolveModelId(parsed.data.defaultModel),
          }
        : {}),
      ...(parsed.data.defaultMaxSteps !== undefined
        ? { defaultMaxSteps: parsed.data.defaultMaxSteps }
        : {}),
      ...(parsed.data.defaultPermissionMode !== undefined
        ? { defaultPermissionMode: parsed.data.defaultPermissionMode }
        : {}),
    };
    if (Object.keys(agentPatch).length > 0) {
      updateWorkspaceSettings(agentPatch);
    }
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
    defaultModel: settings.defaultModel,
    defaultMaxSteps: settings.defaultMaxSteps,
    defaultPermissionMode: settings.defaultPermissionMode,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
