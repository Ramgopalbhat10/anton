import { z } from "zod";

import {
  mcpServerConfigSchema,
  mcpTransportSchema,
} from "@/src/agent/mcp-config";

export const mcpServerInputSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  transport: mcpTransportSchema,
  config: mcpServerConfigSchema,
  enabled: z.boolean().optional(),
});

export const mcpServerPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  transport: mcpTransportSchema.optional(),
  config: mcpServerConfigSchema.optional(),
  enabled: z.boolean().optional(),
});

export const mcpServerIdsSchema = z.object({
  serverIds: z.array(z.string().min(1)).optional(),
});

export const mcpTrustInputSchema = z.object({
  serverId: z.string().min(1),
  fingerprint: z.string().min(64).max(64),
  approved: z.boolean(),
});
