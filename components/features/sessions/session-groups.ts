import type { ProjectSummary } from "@/src/lib/api-types";

import type { SessionSummary } from "./session-store";

export const CHAT_ONLY_GROUP_ID = "chat-only";
export const SESSION_GROUP_PREVIEW_COUNT = 5;

export type SessionGroup = {
  id: string;
  label: string;
  project: ProjectSummary | null;
  sessions: SessionSummary[];
};

export function groupSessionsByProject(
  sessions: SessionSummary[],
  projects: ProjectSummary[],
): SessionGroup[] {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const buckets = new Map<string, SessionSummary[]>();

  for (const session of sessions) {
    const key = session.projectId ?? CHAT_ONLY_GROUP_ID;
    const list = buckets.get(key);
    if (list) {
      list.push(session);
    } else {
      buckets.set(key, [session]);
    }
  }

  const sortSessions = (a: SessionSummary, b: SessionSummary) =>
    b.updatedAt - a.updatedAt;

  const chatOnlySessions = buckets.get(CHAT_ONLY_GROUP_ID)?.slice().sort(sortSessions);
  const groups: SessionGroup[] = [];

  if (chatOnlySessions && chatOnlySessions.length > 0) {
    groups.push({
      id: CHAT_ONLY_GROUP_ID,
      label: "Chat only",
      project: null,
      sessions: chatOnlySessions,
    });
  }

  const projectGroups = [...buckets.entries()]
    .filter(([id]) => id !== CHAT_ONLY_GROUP_ID)
    .map(([id, groupSessions]) => {
      const project = projectsById.get(id) ?? null;
      const sorted = groupSessions.slice().sort(sortSessions);
      return {
        id,
        label: project?.fullName ?? project?.name ?? "Unknown project",
        project,
        sessions: sorted,
        newestAt: sorted[0]?.updatedAt ?? 0,
      };
    })
    .sort((a, b) => b.newestAt - a.newestAt);

  for (const group of projectGroups) {
    groups.push({
      id: group.id,
      label: group.label,
      project: group.project,
      sessions: group.sessions,
    });
  }

  return groups;
}

export type SessionViewMode = "recent" | "projects";

export const SESSION_VIEW_STORAGE_KEY = "anton.sidebar.sessionView";

export function readSessionViewMode(): SessionViewMode {
  if (typeof window === "undefined") return "recent";
  try {
    const value = window.localStorage.getItem(SESSION_VIEW_STORAGE_KEY);
    return value === "projects" ? "projects" : "recent";
  } catch {
    return "recent";
  }
}

export function writeSessionViewMode(mode: SessionViewMode): void {
  try {
    window.localStorage.setItem(SESSION_VIEW_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}
