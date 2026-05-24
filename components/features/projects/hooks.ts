"use client";

import { useCallback, useEffect, useSyncExternalStore, useState } from "react";

import type {
  ProjectBackgroundCommandsSummary,
  ProjectFileTreeSummary,
  ProjectGitStatusSummary,
  ProjectStatusSummary,
  ProjectSummary,
} from "@/src/lib/api-types";
import { errorMessage, getJson } from "@/src/lib/client-fetch";

export const PROJECT_GIT_CHANGED_EVENT = "anton-project-git-change";
const PROJECT_GIT_STATUS_POLL_INTERVAL_MS = 120_000;

export function useProjectsList(): {
  projects: ProjectSummary[];
  readyProjects: ProjectSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getJson<{ projects: ProjectSummary[] }>("/api/projects");
      setProjects(data.projects);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load projects"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial project list hydration updates state after async requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return {
    projects,
    readyProjects: projects.filter((project) => project.status === "ready"),
    loading,
    error,
    refresh,
  };
}

export function useProjectSummary(projectId: string | null): ProjectSummary | null {
  const [loadedProject, setLoadedProject] = useState<{
    projectId: string;
    project: ProjectSummary | null;
  } | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const loadProject = async () => {
      try {
        const data = await getJson<{ project: ProjectSummary }>(
          `/api/projects/${projectId}`,
        );
        setLoadedProject({ projectId, project: data.project });
      } catch {
        setLoadedProject({ projectId, project: null });
      }
    };
    void loadProject();
  }, [projectId]);

  return loadedProject?.projectId === projectId ? loadedProject.project : null;
}

export function useProjectGitStatus(
  projectId: string | null,
): ProjectGitStatusSummary | null {
  const [loadedStatus, setLoadedStatus] = useState<{
    projectId: string;
    status: ProjectGitStatusSummary | null;
  } | null>(null);

  useEffect(() => {
    if (!projectId) {
      queueMicrotask(() => setLoadedStatus(null));
      return;
    }

    let cancelled = false;
    let loading = false;
    let pollTimeout: number | null = null;
    const loadStatus = async () => {
      if (loading) return;
      loading = true;
      try {
        const data = await getJson<{ status: ProjectGitStatusSummary }>(
          `/api/projects/${projectId}/git/status`,
        );
        if (!cancelled) {
          setLoadedStatus({ projectId, status: data.status });
        }
      } catch {
        if (!cancelled) {
          setLoadedStatus((current) =>
            current?.projectId === projectId ? current : { projectId, status: null },
          );
        }
      } finally {
        loading = false;
      }
    };
    const schedulePoll = () => {
      if (cancelled) return;
      pollTimeout = window.setTimeout(() => {
        void loadStatus().finally(schedulePoll);
      }, PROJECT_GIT_STATUS_POLL_INTERVAL_MS);
    };

    void loadStatus().finally(schedulePoll);
    const onProjectGitChanged = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        typeof event.detail === "string" &&
        event.detail === projectId
      ) {
        void loadStatus();
      }
    };
    window.addEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);
    return () => {
      cancelled = true;
      if (pollTimeout !== null) {
        window.clearTimeout(pollTimeout);
      }
      window.removeEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);
    };
  }, [projectId]);

  return loadedStatus?.projectId === projectId ? loadedStatus.status : null;
}

export function notifyProjectGitChanged(projectId: string): void {
  window.dispatchEvent(new CustomEvent(PROJECT_GIT_CHANGED_EVENT, { detail: projectId }));
}

const PROJECT_STATUS_POLL_INTERVAL_MS = 120_000;
const PROJECT_COMMANDS_POLL_INTERVAL_MS = 5_000;

export const PROJECT_COMMANDS_CHANGED_EVENT = "anton-project-commands-change";

export type StartBackgroundCommandInput =
  | { kind: "script"; scriptName: string }
  | { kind: "custom"; command: string };

export const OPEN_WORKLOG_STATUS_EVENT = "anton-open-worklog-status";

type ProjectStatusStoreState = {
  status: ProjectStatusSummary | null;
  loading: boolean;
  error: string | null;
};

type ProjectStatusStore = {
  state: ProjectStatusStoreState;
  listeners: Set<() => void>;
  subscribers: number;
  pollTimeout: number | null;
  loadPromise: Promise<void> | null;
};

const EMPTY_STATUS_STATE: ProjectStatusStoreState = {
  status: null,
  loading: false,
  error: null,
};

const projectStatusStores = new Map<string, ProjectStatusStore>();

function getProjectStatusStore(projectId: string): ProjectStatusStore {
  const existing = projectStatusStores.get(projectId);
  if (existing) return existing;

  const store: ProjectStatusStore = {
    state: EMPTY_STATUS_STATE,
    listeners: new Set(),
    subscribers: 0,
    pollTimeout: null,
    loadPromise: null,
  };
  projectStatusStores.set(projectId, store);
  return store;
}

function setProjectStatusStoreState(
  store: ProjectStatusStore,
  patch: Partial<ProjectStatusStoreState>,
): void {
  store.state = { ...store.state, ...patch };
  for (const listener of store.listeners) {
    listener();
  }
}

function clearProjectStatusPoll(store: ProjectStatusStore): void {
  if (store.pollTimeout !== null) {
    window.clearTimeout(store.pollTimeout);
    store.pollTimeout = null;
  }
}

function scheduleProjectStatusPoll(projectId: string, store: ProjectStatusStore): void {
  clearProjectStatusPoll(store);
  if (store.subscribers === 0) return;

  store.pollTimeout = window.setTimeout(() => {
    store.pollTimeout = null;
    void loadProjectStatus(projectId, store, { background: true }).finally(() => {
      scheduleProjectStatusPoll(projectId, store);
    });
  }, PROJECT_STATUS_POLL_INTERVAL_MS);
}

async function loadProjectStatus(
  projectId: string,
  store: ProjectStatusStore,
  options: { background?: boolean } = {},
): Promise<void> {
  if (store.loadPromise) {
    await store.loadPromise;
    return;
  }

  const hasCache = store.state.status !== null;
  if (!options.background && !hasCache) {
    setProjectStatusStoreState(store, { loading: true });
  }

  store.loadPromise = (async () => {
    try {
      const data = await getJson<{ status: ProjectStatusSummary }>(
        `/api/projects/${projectId}/status`,
      );
      setProjectStatusStoreState(store, {
        status: data.status,
        error: null,
        loading: false,
      });
    } catch (err) {
      setProjectStatusStoreState(store, {
        status: hasCache ? store.state.status : null,
        error:
          err instanceof Error ? err.message : "Failed to load project status",
        loading: false,
      });
    } finally {
      store.loadPromise = null;
    }
  })();

  await store.loadPromise;
}

function subscribeProjectStatus(
  projectId: string,
  listener: () => void,
): () => void {
  const store = getProjectStatusStore(projectId);
  store.subscribers += 1;
  store.listeners.add(listener);

  if (store.state.status === null && store.loadPromise === null) {
    void loadProjectStatus(projectId, store).finally(() => {
      scheduleProjectStatusPoll(projectId, store);
    });
  } else {
    scheduleProjectStatusPoll(projectId, store);
  }

  const onProjectGitChanged = (event: Event) => {
    if (
      event instanceof CustomEvent &&
      typeof event.detail === "string" &&
      event.detail === projectId
    ) {
      void loadProjectStatus(projectId, store, { background: true }).finally(() => {
        scheduleProjectStatusPoll(projectId, store);
      });
    }
  };
  window.addEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);

  return () => {
    store.listeners.delete(listener);
    store.subscribers = Math.max(0, store.subscribers - 1);
    window.removeEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);
    if (store.subscribers === 0) {
      clearProjectStatusPoll(store);
    }
  };
}

export function useProjectStatus(projectId: string | null): {
  status: ProjectStatusSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!projectId) return () => {};
      return subscribeProjectStatus(projectId, listener);
    },
    [projectId],
  );

  const getSnapshot = useCallback((): ProjectStatusStoreState => {
    if (!projectId) return EMPTY_STATUS_STATE;
    return getProjectStatusStore(projectId).state;
  }, [projectId]);

  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_STATUS_STATE);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const store = getProjectStatusStore(projectId);
    await loadProjectStatus(projectId, store);
    scheduleProjectStatusPoll(projectId, store);
  }, [projectId]);

  return {
    status: state.status,
    loading: state.loading,
    error: state.error,
    refresh,
  };
}

export function notifyOpenWorklogStatus(): void {
  window.dispatchEvent(new CustomEvent(OPEN_WORKLOG_STATUS_EVENT));
}

export function notifyProjectCommandsChanged(projectId: string): void {
  window.dispatchEvent(
    new CustomEvent(PROJECT_COMMANDS_CHANGED_EVENT, { detail: projectId }),
  );
}

type ProjectCommandsStoreState = {
  commands: ProjectBackgroundCommandsSummary | null;
  loading: boolean;
  error: string | null;
};

type ProjectCommandsStore = {
  state: ProjectCommandsStoreState;
  listeners: Set<() => void>;
  subscribers: number;
  pollTimeout: number | null;
  loadPromise: Promise<void> | null;
};

const EMPTY_COMMANDS_STATE: ProjectCommandsStoreState = {
  commands: null,
  loading: false,
  error: null,
};

const projectCommandsStores = new Map<string, ProjectCommandsStore>();

function getProjectCommandsStore(projectId: string): ProjectCommandsStore {
  const existing = projectCommandsStores.get(projectId);
  if (existing) return existing;

  const store: ProjectCommandsStore = {
    state: EMPTY_COMMANDS_STATE,
    listeners: new Set(),
    subscribers: 0,
    pollTimeout: null,
    loadPromise: null,
  };
  projectCommandsStores.set(projectId, store);
  return store;
}

function setProjectCommandsStoreState(
  store: ProjectCommandsStore,
  patch: Partial<ProjectCommandsStoreState>,
): void {
  store.state = { ...store.state, ...patch };
  for (const listener of store.listeners) {
    listener();
  }
}

function clearProjectCommandsPoll(store: ProjectCommandsStore): void {
  if (store.pollTimeout !== null) {
    window.clearTimeout(store.pollTimeout);
    store.pollTimeout = null;
  }
}

function scheduleProjectCommandsPoll(projectId: string, store: ProjectCommandsStore): void {
  clearProjectCommandsPoll(store);
  if (store.subscribers === 0) return;
  if ((store.state.commands?.runningCount ?? 0) === 0) return;

  store.pollTimeout = window.setTimeout(() => {
    store.pollTimeout = null;
    void loadProjectCommands(projectId, store).finally(() => {
      scheduleProjectCommandsPoll(projectId, store);
    });
  }, PROJECT_COMMANDS_POLL_INTERVAL_MS);
}

async function loadProjectCommands(
  projectId: string,
  store: ProjectCommandsStore,
  options: { background?: boolean } = {},
): Promise<void> {
  if (store.loadPromise) {
    await store.loadPromise;
    return;
  }

  const hasCache = store.state.commands !== null;
  if (!options.background && !hasCache) {
    setProjectCommandsStoreState(store, { loading: true });
  }

  store.loadPromise = (async () => {
    try {
      const data = await getJson<{ commands: ProjectBackgroundCommandsSummary }>(
        `/api/projects/${projectId}/commands`,
      );
      setProjectCommandsStoreState(store, {
        commands: data.commands,
        error: null,
        loading: false,
      });
    } catch (err) {
      setProjectCommandsStoreState(store, {
        commands: hasCache ? store.state.commands : null,
        error:
          err instanceof Error ? err.message : "Failed to load commands",
        loading: false,
      });
    } finally {
      store.loadPromise = null;
    }
  })();

  await store.loadPromise;
}

function subscribeProjectCommands(
  projectId: string,
  listener: () => void,
): () => void {
  const store = getProjectCommandsStore(projectId);
  store.subscribers += 1;
  store.listeners.add(listener);

  if (store.state.commands === null && store.loadPromise === null) {
    void loadProjectCommands(projectId, store).finally(() => {
      scheduleProjectCommandsPoll(projectId, store);
    });
  } else {
    scheduleProjectCommandsPoll(projectId, store);
  }

  const onCommandsChanged = (event: Event) => {
    if (
      event instanceof CustomEvent &&
      typeof event.detail === "string" &&
      event.detail === projectId
    ) {
      void loadProjectCommands(projectId, store, { background: true }).finally(() => {
        scheduleProjectCommandsPoll(projectId, store);
      });
    }
  };
  window.addEventListener(PROJECT_COMMANDS_CHANGED_EVENT, onCommandsChanged);

  return () => {
    store.listeners.delete(listener);
    store.subscribers = Math.max(0, store.subscribers - 1);
    window.removeEventListener(PROJECT_COMMANDS_CHANGED_EVENT, onCommandsChanged);
    if (store.subscribers === 0) {
      clearProjectCommandsPoll(store);
    }
  };
}

export function useProjectCommands(projectId: string | null): {
  commands: ProjectBackgroundCommandsSummary | null;
  loading: boolean;
  error: string | null;
  runningCount: number;
  refresh: () => Promise<void>;
} {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!projectId) return () => {};
      return subscribeProjectCommands(projectId, listener);
    },
    [projectId],
  );

  const getSnapshot = useCallback((): ProjectCommandsStoreState => {
    if (!projectId) return EMPTY_COMMANDS_STATE;
    return getProjectCommandsStore(projectId).state;
  }, [projectId]);

  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_COMMANDS_STATE);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const store = getProjectCommandsStore(projectId);
    await loadProjectCommands(projectId, store, {
      background: store.state.commands !== null,
    });
    scheduleProjectCommandsPoll(projectId, store);
  }, [projectId]);

  return {
    commands: state.commands,
    loading: state.loading,
    error: state.error,
    runningCount: state.commands?.runningCount ?? 0,
    refresh,
  };
}

const PROJECT_FILES_POLL_INTERVAL_MS = 60_000;

type ProjectFilesStoreState = {
  fileTree: ProjectFileTreeSummary | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
};

type ProjectFilesStore = {
  state: ProjectFilesStoreState;
  listeners: Set<() => void>;
  subscribers: number;
  pollTimeout: number | null;
  loadPromise: Promise<void> | null;
};

const EMPTY_FILES_STATE: ProjectFilesStoreState = {
  fileTree: null,
  loading: false,
  refreshing: false,
  error: null,
};

const projectFilesStores = new Map<string, ProjectFilesStore>();

function getProjectFilesStore(projectId: string): ProjectFilesStore {
  const existing = projectFilesStores.get(projectId);
  if (existing) return existing;

  const store: ProjectFilesStore = {
    state: EMPTY_FILES_STATE,
    listeners: new Set(),
    subscribers: 0,
    pollTimeout: null,
    loadPromise: null,
  };
  projectFilesStores.set(projectId, store);
  return store;
}

function setProjectFilesStoreState(
  store: ProjectFilesStore,
  patch: Partial<ProjectFilesStoreState>,
): void {
  store.state = { ...store.state, ...patch };
  for (const listener of store.listeners) {
    listener();
  }
}

function clearProjectFilesPoll(store: ProjectFilesStore): void {
  if (store.pollTimeout !== null) {
    window.clearTimeout(store.pollTimeout);
    store.pollTimeout = null;
  }
}

function scheduleProjectFilesPoll(projectId: string, store: ProjectFilesStore): void {
  clearProjectFilesPoll(store);
  if (store.subscribers === 0) return;

  store.pollTimeout = window.setTimeout(() => {
    store.pollTimeout = null;
    void loadProjectFiles(projectId, store, { background: true }).finally(() => {
      scheduleProjectFilesPoll(projectId, store);
    });
  }, PROJECT_FILES_POLL_INTERVAL_MS);
}

async function loadProjectFiles(
  projectId: string,
  store: ProjectFilesStore,
  options: { background?: boolean } = {},
): Promise<void> {
  if (store.loadPromise) {
    await store.loadPromise;
    return;
  }

  const hasCache = store.state.fileTree !== null;
  if (options.background) {
    setProjectFilesStoreState(store, { refreshing: true });
  } else if (!hasCache) {
    setProjectFilesStoreState(store, { loading: true });
  }

  store.loadPromise = (async () => {
    try {
      const data = await getJson<{ fileTree: ProjectFileTreeSummary }>(
        `/api/projects/${projectId}/files`,
      );
      setProjectFilesStoreState(store, {
        fileTree: data.fileTree,
        error: null,
        loading: false,
        refreshing: false,
      });
    } catch (err) {
      setProjectFilesStoreState(store, {
        fileTree: hasCache ? store.state.fileTree : null,
        error: errorMessage(err, "Failed to load project files"),
        loading: false,
        refreshing: false,
      });
    } finally {
      store.loadPromise = null;
    }
  })();

  await store.loadPromise;
}

function subscribeProjectFiles(
  projectId: string,
  listener: () => void,
): () => void {
  const store = getProjectFilesStore(projectId);
  store.subscribers += 1;
  store.listeners.add(listener);

  if (store.state.fileTree === null && store.loadPromise === null) {
    void loadProjectFiles(projectId, store).finally(() => {
      scheduleProjectFilesPoll(projectId, store);
    });
  } else {
    scheduleProjectFilesPoll(projectId, store);
  }

  const onProjectGitChanged = (event: Event) => {
    if (
      event instanceof CustomEvent &&
      typeof event.detail === "string" &&
      event.detail === projectId
    ) {
      void loadProjectFiles(projectId, store, { background: true });
    }
  };
  window.addEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);

  return () => {
    store.listeners.delete(listener);
    store.subscribers = Math.max(0, store.subscribers - 1);
    window.removeEventListener(PROJECT_GIT_CHANGED_EVENT, onProjectGitChanged);
    if (store.subscribers === 0) {
      clearProjectFilesPoll(store);
    }
  };
}

export function useProjectFileTree(projectId: string | null): {
  fileTree: ProjectFileTreeSummary | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!projectId) return () => {};
      return subscribeProjectFiles(projectId, listener);
    },
    [projectId],
  );

  const getSnapshot = useCallback((): ProjectFilesStoreState => {
    if (!projectId) return EMPTY_FILES_STATE;
    return getProjectFilesStore(projectId).state;
  }, [projectId]);

  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_FILES_STATE);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const store = getProjectFilesStore(projectId);
    await loadProjectFiles(projectId, store, {
      background: store.state.fileTree !== null,
    });
    scheduleProjectFilesPoll(projectId, store);
  }, [projectId]);

  return {
    fileTree: state.fileTree,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    refresh,
  };
}
