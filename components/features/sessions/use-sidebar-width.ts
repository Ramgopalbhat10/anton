"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const SESSION_SIDEBAR_WIDTH_DEFAULT = 280;
export const SESSION_SIDEBAR_WIDTH_MIN = 240;
export const SESSION_SIDEBAR_WIDTH_MAX = 420;

const STORAGE_KEY = "anton-session-sidebar-width";

function clampWidth(width: number): number {
  return Math.min(
    SESSION_SIDEBAR_WIDTH_MAX,
    Math.max(SESSION_SIDEBAR_WIDTH_MIN, Math.round(width)),
  );
}

function readStoredWidth(): number {
  if (typeof window === "undefined") return SESSION_SIDEBAR_WIDTH_DEFAULT;

  const stored = Number.parseInt(
    window.localStorage.getItem(STORAGE_KEY) ?? "",
    10,
  );
  return Number.isFinite(stored)
    ? clampWidth(stored)
    : SESSION_SIDEBAR_WIDTH_DEFAULT;
}

export function useSidebarWidth() {
  const [width, setWidth] = useState(SESSION_SIDEBAR_WIDTH_DEFAULT);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

  const persist = useCallback((nextWidth: number) => {
    window.localStorage.setItem(STORAGE_KEY, String(nextWidth));
  }, []);

  const startResize = useCallback((clientX: number) => {
    setWidth((current) => {
      resizeStartRef.current = { startX: clientX, startWidth: current };
      return current;
    });
    setIsResizing(true);
  }, []);

  useEffect(() => {
    queueMicrotask(() => setWidth(readStoredWidth()));
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const onMouseMove = (event: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      setWidth(clampWidth(start.startWidth + event.clientX - start.startX));
    };

    const onMouseUp = () => {
      resizeStartRef.current = null;
      setIsResizing(false);
      setWidth((current) => {
        persist(current);
        return current;
      });
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizing, persist]);

  return { width, isResizing, startResize };
}
