import type { Memory, Project } from "@/src/db/schema";
import type { ProjectMemory, ProjectSummary } from "./api-types";

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
