"use client";

import { useEffect, useState } from "react";

const ACTIVE_PROJECT_KEY = "anton.activeProjectId";
const ACTIVE_PROJECT_EVENT = "anton-active-project-change";

export function readActiveProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_PROJECT_KEY);
}

export function writeActiveProjectId(projectId: string): void {
  if (typeof window === "undefined") return;
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

export function useActiveProjectIdState(
  initialProjectId: string | null = null,
  options: { listen?: boolean } = {},
): [string | null, (projectId: string | null) => void] {
  const { listen = true } = options;
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    initialProjectId,
  );

  useEffect(() => {
    if (initialProjectId || !listen) return;
    const storedProjectId = readActiveProjectId();
    // Local storage is client-only; syncing after mount keeps hydration stable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (storedProjectId) setActiveProjectId(storedProjectId);
  }, [initialProjectId, listen]);

  useEffect(() => {
    if (!listen) return;
    const onActiveProjectChange = (event: Event) => {
      if (isActiveProjectChangeEvent(event)) setActiveProjectId(event.detail);
    };
    window.addEventListener(ACTIVE_PROJECT_EVENT, onActiveProjectChange);
    return () =>
      window.removeEventListener(ACTIVE_PROJECT_EVENT, onActiveProjectChange);
  }, [listen]);

  return [activeProjectId, setActiveProjectId];
}

export { ACTIVE_PROJECT_EVENT };
