"use client";

const ACTIVE_PROJECT_KEY = "anton.activeProjectId";
const ACTIVE_PROJECT_EVENT = "anton-active-project-change";

export function readActiveProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_PROJECT_KEY);
}

export function writeActiveProjectId(projectId: string): void {
  localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
  window.dispatchEvent(
    new CustomEvent(ACTIVE_PROJECT_EVENT, { detail: projectId }),
  );
}

export function isActiveProjectChangeEvent(
  event: Event,
): event is CustomEvent<string> {
  return event instanceof CustomEvent && typeof event.detail === "string";
}

export { ACTIVE_PROJECT_EVENT };
