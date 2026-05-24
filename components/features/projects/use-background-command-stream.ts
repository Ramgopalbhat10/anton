"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

export type BackgroundCommandStreamEvent =
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string }
  | {
      type: "status";
      status: string;
      exitCode?: number | null;
      signal?: string | null;
      detectedUrls?: string[];
      finished?: boolean;
    };

export interface BackgroundCommandStreamState {
  stdout: string;
  stderr: string;
  status: string;
  exitCode?: number | null;
  signal?: string | null;
  detectedUrls: string[];
  finished: boolean;
  error?: string;
}

interface BackgroundCommandStreamStore {
  state: BackgroundCommandStreamState;
  listeners: Set<() => void>;
  subscribers: number;
  eventSource: EventSource | null;
  reconnectTimeout: number | null;
  closeTimeout: number | null;
}

const EMPTY_STATE: BackgroundCommandStreamState = {
  stdout: "",
  stderr: "",
  status: "starting",
  detectedUrls: [],
  finished: false,
};

const MAX_OUTPUT_CHARS = 64 * 1024;
const RECONNECT_DELAY_MS = 1_000;
const CLOSE_GRACE_MS = 500;

const stores = new Map<string, BackgroundCommandStreamStore>();

export function useBackgroundCommandStream(
  projectId: string | undefined,
  commandId: string | undefined,
  token: string | undefined,
  enabled: boolean,
): BackgroundCommandStreamState {
  const active = useMemo(
    () =>
      enabled && projectId && commandId && token
        ? { projectId, commandId, token }
        : undefined,
    [enabled, projectId, commandId, token],
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!active) return () => {};
      return subscribeToBackgroundCommandStream(active, onStoreChange);
    },
    [active],
  );

  const getSnapshot = useCallback(() => {
    if (!active) return EMPTY_STATE;
    return getStore(storeKey(active.projectId, active.commandId, active.token))
      .state;
  }, [active]);

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_STATE);
}

function subscribeToBackgroundCommandStream(
  active: { projectId: string; commandId: string; token: string },
  listener: () => void,
): () => void {
  const key = storeKey(active.projectId, active.commandId, active.token);
  const store = getStore(key);
  store.subscribers += 1;
  store.listeners.add(listener);

  if (store.closeTimeout !== null) {
    window.clearTimeout(store.closeTimeout);
    store.closeTimeout = null;
  }

  if (!store.state.finished) {
    connectStore(active, store);
  }

  return () => {
    store.listeners.delete(listener);
    store.subscribers = Math.max(0, store.subscribers - 1);
    if (store.subscribers > 0 || store.closeTimeout !== null) return;

    store.closeTimeout = window.setTimeout(() => {
      store.closeTimeout = null;
      if (store.subscribers > 0) return;
      closeStore(key, store);
    }, CLOSE_GRACE_MS);
  };
}

function getStore(key: string): BackgroundCommandStreamStore {
  const existing = stores.get(key);
  if (existing) return existing;

  const store: BackgroundCommandStreamStore = {
    state: EMPTY_STATE,
    listeners: new Set(),
    subscribers: 0,
    eventSource: null,
    reconnectTimeout: null,
    closeTimeout: null,
  };
  stores.set(key, store);
  return store;
}

function connectStore(
  active: { projectId: string; commandId: string; token: string },
  store: BackgroundCommandStreamStore,
): void {
  if (store.eventSource || store.reconnectTimeout !== null) return;

  const eventSource = new EventSource(
    `/api/projects/${encodeURIComponent(active.projectId)}/commands/${encodeURIComponent(active.commandId)}/stream?token=${encodeURIComponent(active.token)}`,
  );
  store.eventSource = eventSource;

  eventSource.onmessage = (event) => {
    let data: BackgroundCommandStreamEvent;
    try {
      data = JSON.parse(event.data) as BackgroundCommandStreamEvent;
    } catch {
      return;
    }

    if (data.type === "stdout") {
      setStoreState(store, {
        ...store.state,
        stdout: capOutput(store.state.stdout + data.chunk),
      });
      return;
    }

    if (data.type === "stderr") {
      setStoreState(store, {
        ...store.state,
        stderr: capOutput(store.state.stderr + data.chunk),
      });
      return;
    }

    setStoreState(store, {
      ...store.state,
      status: data.status,
      exitCode: data.exitCode,
      signal: data.signal,
      detectedUrls: data.detectedUrls ?? store.state.detectedUrls,
      finished: true,
    });
    closeEventSource(store, eventSource);
  };

  eventSource.onerror = () => {
    if (store.eventSource !== eventSource) return;
    closeEventSource(store, eventSource);
    if (store.state.finished || store.subscribers === 0) return;

    store.reconnectTimeout = window.setTimeout(() => {
      store.reconnectTimeout = null;
      if (!store.state.finished && store.subscribers > 0) {
        connectStore(active, store);
      }
    }, RECONNECT_DELAY_MS);
  };
}

function setStoreState(
  store: BackgroundCommandStreamStore,
  state: BackgroundCommandStreamState,
): void {
  store.state = state;
  for (const listener of store.listeners) {
    listener();
  }
}

function closeStore(key: string, store: BackgroundCommandStreamStore): void {
  closeEventSource(store, store.eventSource);
  if (store.reconnectTimeout !== null) {
    window.clearTimeout(store.reconnectTimeout);
    store.reconnectTimeout = null;
  }
  stores.delete(key);
}

function closeEventSource(
  store: BackgroundCommandStreamStore,
  eventSource: EventSource | null,
): void {
  if (!eventSource || store.eventSource !== eventSource) return;
  store.eventSource = null;
  eventSource.close();
}

function capOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return output.slice(output.length - MAX_OUTPUT_CHARS);
}

function storeKey(projectId: string, commandId: string, token: string): string {
  return `${projectId}:${commandId}:${token}`;
}
