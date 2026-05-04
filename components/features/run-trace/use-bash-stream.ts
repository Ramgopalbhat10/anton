"use client";

import { useCallback, useSyncExternalStore } from "react";

export type BashStreamChunk =
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string }
  | {
      type: "exit";
      exitCode: number | null;
      timedOut: boolean;
      killed: boolean;
      failedReason?: BashFailedReason;
      finished?: boolean;
    };

export type BashFailedReason = "timeout" | "killed" | "max_buffer" | "error";

export interface BashStreamState {
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  timedOut?: boolean;
  killed?: boolean;
  failedReason?: BashFailedReason;
  finished: boolean;
  error?: string;
}

interface BashStreamStore {
  state: BashStreamState;
  listeners: Set<() => void>;
  subscribers: number;
  eventSource: EventSource | null;
  reconnectTimeout: number | null;
  closeTimeout: number | null;
}

const EMPTY_STATE: BashStreamState = {
  stdout: "",
  stderr: "",
  finished: false,
};

const MAX_OUTPUT_CHARS = 64 * 1024;
const RECONNECT_DELAY_MS = 1_000;
const CLOSE_GRACE_MS = 500;

const stores = new Map<string, BashStreamStore>();

export function useBashStream(
  streamId: string | undefined,
  token: string | undefined,
  enabled: boolean,
): BashStreamState {
  const activeStreamId = enabled && token ? streamId : undefined;
  const activeToken = activeStreamId ? token : undefined;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!activeStreamId || !activeToken) return () => {};
      return subscribeToBashStream(activeStreamId, activeToken, onStoreChange);
    },
    [activeStreamId, activeToken],
  );

  const getSnapshot = useCallback(() => {
    if (!activeStreamId || !activeToken) return EMPTY_STATE;
    return getStore(storeKey(activeStreamId, activeToken)).state;
  }, [activeStreamId, activeToken]);

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_STATE);
}

function subscribeToBashStream(
  streamId: string,
  token: string,
  listener: () => void,
): () => void {
  const key = storeKey(streamId, token);
  const store = getStore(key);
  store.subscribers += 1;
  store.listeners.add(listener);

  if (store.closeTimeout !== null) {
    window.clearTimeout(store.closeTimeout);
    store.closeTimeout = null;
  }

  if (!store.state.finished) {
    connectStore(streamId, token, store);
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

function getStore(key: string): BashStreamStore {
  const existing = stores.get(key);
  if (existing) return existing;

  const store: BashStreamStore = {
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
  streamId: string,
  token: string,
  store: BashStreamStore,
): void {
  if (store.eventSource || store.reconnectTimeout !== null) return;

  const eventSource = new EventSource(
    `/api/bash-stream?streamId=${encodeURIComponent(streamId)}&token=${encodeURIComponent(token)}`,
  );
  store.eventSource = eventSource;

  eventSource.onmessage = (event) => {
    let data: BashStreamChunk;
    try {
      data = JSON.parse(event.data) as BashStreamChunk;
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
      exitCode: data.exitCode,
      timedOut: data.timedOut,
      killed: data.killed,
      failedReason: data.failedReason,
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
        connectStore(streamId, token, store);
      }
    }, RECONNECT_DELAY_MS);
  };
}

function setStoreState(store: BashStreamStore, state: BashStreamState): void {
  store.state = state;
  for (const listener of store.listeners) {
    listener();
  }
}

function closeStore(key: string, store: BashStreamStore): void {
  closeEventSource(store, store.eventSource);
  if (store.reconnectTimeout !== null) {
    window.clearTimeout(store.reconnectTimeout);
    store.reconnectTimeout = null;
  }
  stores.delete(key);
}

function closeEventSource(
  store: BashStreamStore,
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

function storeKey(streamId: string, token: string): string {
  return `${streamId}:${token}`;
}
