import {
  fingerprintMcpConfig,
  makeMcpApprovalDetails,
  redactMcpConfig,
  summarizeMcpConfig,
  type McpServerConfig,
} from "@/src/agent/mcp-config";
import { getMcpTrustDecision } from "@/src/db/queries";
import type {
  BackgroundCommandSession,
  Memory,
  McpServer,
  Project,
} from "@/src/db/schema";
import type {
  BackgroundCommandSessionSummary,
  McpServerSummary,
  ProjectMemory,
  ProjectSummary,
} from "./api-types";

export function serializeProject(project: Project): ProjectSummary {
  return {
    id: project.id,
    provider: project.provider,
    githubRepoId: project.githubRepoId,
    githubInstallationId: project.githubInstallationId,
    owner: project.owner,
    name: project.name,
    fullName: project.fullName,
    defaultBranch: project.defaultBranch,
    cloneUrl: project.cloneUrl,
    localPath: project.localPath,
    status: project.status,
    lastError: project.lastError,
    createdAt: project.createdAt.getTime(),
    updatedAt: project.updatedAt.getTime(),
  };
}

export function serializeMemory(memory: Memory): ProjectMemory {
  return {
    id: memory.id,
    content: memory.content,
    createdAt: memory.createdAt.getTime(),
    updatedAt: memory.updatedAt.getTime(),
  };
}

export function serializeBackgroundCommandSession(
  session: BackgroundCommandSession,
): BackgroundCommandSessionSummary {
  return {
    id: session.id,
    projectId: session.projectId,
    command: session.command,
    commandKind: session.commandKind,
    status: session.status,
    pid: session.pid,
    startedAt: session.startedAt?.getTime() ?? null,
    finishedAt: session.finishedAt?.getTime() ?? null,
    exitCode: session.exitCode,
    signal: session.signal,
    stdoutTail: session.stdoutTail,
    stderrTail: session.stderrTail,
    detectedUrls: session.detectedUrls,
    createdAt: session.createdAt.getTime(),
    updatedAt: session.updatedAt.getTime(),
  };
}

export function serializeMcpServer(server: McpServer): McpServerSummary {
  const config = server.config as McpServerConfig;
  const fingerprint = fingerprintMcpConfig(config);
  const decision = getMcpTrustDecision(server.id, fingerprint)?.decision ?? null;
  return {
    id: server.id,
    displayName: server.displayName,
    namespace: server.namespace,
    transport: server.transport,
    config: redactMcpConfig(config),
    enabled: server.enabled,
    summary: summarizeMcpConfig(config),
    trust: {
      fingerprint,
      trusted: decision === "approved",
      decision,
      approval: makeMcpApprovalDetails({
        displayName: server.displayName,
        config,
      }),
    },
    lastStatus: server.lastStatus,
    lastError: server.lastError,
    lastCheckedAt: server.lastCheckedAt?.getTime() ?? null,
    createdAt: server.createdAt.getTime(),
    updatedAt: server.updatedAt.getTime(),
  };
}
