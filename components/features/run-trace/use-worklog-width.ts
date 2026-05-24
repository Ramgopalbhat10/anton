"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export const WORKLOG_WIDTH_MIN = 420;
export const WORKLOG_WIDTH_MAX_RATIO = 0.65;
const WORKLOG_WIDTH_STORAGE_KEY = "anton-worklog-width";

function readStoredWorklogWidth(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(WORKLOG_WIDTH_STORAGE_KEY);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxWorklogWidth(containerWidth: number): number {
  return Math.max(
    WORKLOG_WIDTH_MIN,
    Math.floor(containerWidth * WORKLOG_WIDTH_MAX_RATIO),
  );
}

function clampWorklogWidth(width: number, containerWidth: number): number {
  return Math.min(
    maxWorklogWidth(containerWidth),
    Math.max(WORKLOG_WIDTH_MIN, Math.round(width)),
  );
}

export function useWorklogWidth(containerRef: RefObject<HTMLElement | null>): {
  width: number;
  maxWidth: number;
  expanded: boolean;
  isResizing: boolean;
  setWidth: (width: number) => void;
  setToMin: () => void;
  setToMax: () => void;
  toggleExpanded: () => void;
  startResize: (clientX: number) => void;
} {
  // Keep SSR and the first client render identical; hydrate from storage after mount.
  const [width, setWidthState] = useState(WORKLOG_WIDTH_MIN);
  const [maxWidth, setMaxWidth] = useState(WORKLOG_WIDTH_MIN);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

  const containerWidth = useCallback(() => {
    return containerRef.current?.clientWidth ?? window.innerWidth;
  }, [containerRef]);

  const measureMaxWidth = useCallback(() => {
    return maxWorklogWidth(containerWidth());
  }, [containerWidth]);

  const persistWidth = useCallback((next: number) => {
    window.localStorage.setItem(WORKLOG_WIDTH_STORAGE_KEY, String(next));
  }, []);

  const setWidth = useCallback(
    (next: number) => {
      const clamped = clampWorklogWidth(next, containerWidth());
      setMaxWidth(measureMaxWidth());
      setWidthState(clamped);
      persistWidth(clamped);
    },
    [containerWidth, measureMaxWidth, persistWidth],
  );

  const setToMin = useCallback(() => {
    setWidth(WORKLOG_WIDTH_MIN);
  }, [setWidth]);

  const setToMax = useCallback(() => {
    const max = measureMaxWidth();
    setMaxWidth(max);
    setWidthState(max);
    persistWidth(max);
  }, [measureMaxWidth, persistWidth]);

  const expanded = width >= maxWidth - 1;

  const toggleExpanded = useCallback(() => {
    if (expanded) {
      setToMin();
    } else {
      setToMax();
    }
  }, [expanded, setToMax, setToMin]);

  const startResize = useCallback((clientX: number) => {
    setWidthState((current) => {
      resizeStartRef.current = { startX: clientX, startWidth: current };
      return current;
    });
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const nextContainerWidth = containerWidth();
    const max = maxWorklogWidth(nextContainerWidth);
    const stored = readStoredWorklogWidth();
    const nextWidth =
      stored !== null
        ? clampWorklogWidth(stored, nextContainerWidth)
        : WORKLOG_WIDTH_MIN;
    queueMicrotask(() => {
      setMaxWidth(max);
      setWidthState(clampWorklogWidth(nextWidth, nextContainerWidth));
    });
  }, [containerWidth]);

  useEffect(() => {
    const onResize = () => {
      const nextContainerWidth = containerWidth();
      const max = maxWorklogWidth(nextContainerWidth);
      setMaxWidth(max);
      setWidthState((current) => {
        const clamped = clampWorklogWidth(current, nextContainerWidth);
        persistWidth(clamped);
        return clamped;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [containerWidth, persistWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const onMove = (event: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const delta = start.startX - event.clientX;
      setWidthState(
        clampWorklogWidth(start.startWidth + delta, containerWidth()),
      );
    };

    const onUp = () => {
      resizeStartRef.current = null;
      setIsResizing(false);
      setWidthState((current) => {
        persistWidth(current);
        return current;
      });
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [containerWidth, isResizing, persistWidth]);

  return {
    width,
    maxWidth,
    expanded,
    isResizing,
    setWidth,
    setToMin,
    setToMax,
    toggleExpanded,
    startResize,
  };
}
