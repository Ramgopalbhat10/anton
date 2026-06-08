import { z } from "zod";

import { getWorkspaceSettings, updateWorkspaceSettings } from "@/src/db/queries";
import { isSupportedAgentModelId } from "@/src/lib/openrouter-catalog";
import { resolveModelId } from "@/src/lib/models";
import { sanitizeOpenRouterRoutingPreferences } from "@/src/lib/openrouter-routing";
import {
  getLocalWorkspacesRoot,
  setLocalWorkspacesRoot,
  WorkspaceRootError,
} from "@/src/workspace/local";

export const runtime = "nodejs";

const permissionModeSchema = z.enum(["default", "auto-review", "full-access"]);
const routingPreferenceSchema = z.object({
  order: z.array(z.string().trim().min(1).max(100)).max(24),
  allowFallbacks: z.boolean(),
});

const patchSchema = z.object({
  localWorkspacesRoot: z.string().trim().min(1).nullable().optional(),
  defaultModel: z.string().trim().min(1).nullable().optional(),
  defaultPermissionMode: permissionModeSchema.nullable().optional(),
  openRouterRoutingPreferences: z
    .record(z.string().trim().min(1), routingPreferenceSchema)
    .nullable()
    .optional(),
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
    !(await isSupportedAgentModelId(parsed.data.defaultModel))
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
      ...(parsed.data.defaultPermissionMode !== undefined
        ? { defaultPermissionMode: parsed.data.defaultPermissionMode }
        : {}),
      ...(parsed.data.openRouterRoutingPreferences !== undefined
        ? {
            openRouterRoutingPreferences: sanitizeOpenRouterRoutingPreferences(
              parsed.data.openRouterRoutingPreferences,
            ),
          }
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
    defaultPermissionMode: settings.defaultPermissionMode,
    openRouterRoutingPreferences: sanitizeOpenRouterRoutingPreferences(
      settings.openRouterRoutingPreferences,
    ),
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
