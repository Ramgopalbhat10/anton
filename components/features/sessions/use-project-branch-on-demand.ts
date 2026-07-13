"use client";

import { useEffect, useState } from "react";

import type { ProjectGitStatusSummary } from "@/src/lib/api-types";
import { getJson } from "@/src/lib/client-fetch";

/**
 * Lazily loads the live git branch for a project while a hover card is open.
 * Skips the network call when disabled or when the project is not a Git repo.
 */
export function useProjectBranchOnDemand(
  projectId: string | null,
  enabled: boolean,
  isGitRepository: boolean,
): string | null {
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !projectId || !isGitRepository) {
      queueMicrotask(() => setBranch(null));
      return;
    }

    let cancelled = false;
    void getJson<{ status: ProjectGitStatusSummary }>(
      `/api/projects/${projectId}/git/status`,
    )
      .then((data) => {
        if (!cancelled) setBranch(data.status.branch);
      })
      .catch(() => {
        if (!cancelled) setBranch(null);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, isGitRepository]);

  if (!enabled || !projectId || !isGitRepository) return null;
  return branch;
}
