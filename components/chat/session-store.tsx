"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type SessionSummary = {
  id: string;
  title: string;
  model: string;
  tokensTotal: number;
  createdAt: number;
  updatedAt: number;
};

interface SessionStoreValue {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const SessionStoreContext = createContext<SessionStoreValue | null>(null);

export function SessionStoreProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sessions: SessionSummary[] };
      setSessions(data.sessions);
      setError(null);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetching on mount — setState happens after `await fetch(...)` resolves,
    // not during the effect body. The rule can't see through `async`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const rename = useCallback(
    async (id: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: trimmed } : s)),
      );
      try {
        const res = await fetch(`/api/sessions/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Rename failed");
        await refresh();
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const snapshot = sessions;
      setSessions((prev) => prev.filter((s) => s.id !== id));
      try {
        const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 204) {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
        setSessions(snapshot);
      }
    },
    [sessions],
  );

  const value = useMemo<SessionStoreValue>(
    () => ({ sessions, loading, error, refresh, rename, remove }),
    [sessions, loading, error, refresh, rename, remove],
  );

  return (
    <SessionStoreContext.Provider value={value}>
      {children}
    </SessionStoreContext.Provider>
  );
}

export function useSessionStore(): SessionStoreValue {
  const ctx = useContext(SessionStoreContext);
  if (!ctx) {
    throw new Error(
      "useSessionStore must be used within a SessionStoreProvider",
    );
  }
  return ctx;
}
