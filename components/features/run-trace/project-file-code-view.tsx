"use client";

import { useEffect, useMemo, useRef } from "react";
import { File as PierreFile } from "@pierre/diffs";
import type { FileContents } from "@pierre/diffs";

import { cn } from "@/lib/utils";

type ProjectFileCodeViewProps = {
  path: string;
  content: string;
  className?: string;
};

const codeViewerOptions = {
  disableFileHeader: true,
  disableLineNumbers: false,
  overflow: "scroll" as const,
  theme: "pierre-dark",
  themeType: "dark" as const,
  unsafeCSS: `
    :host {
      --diffs-dark-bg: hsl(var(--background)/0.25);
      --diffs-dark: #ededed;
      --diffs-font-size: 11px;
      --diffs-line-height: 19px;
      --diffs-font-family: var(--font-geist-mono), "SF Mono", Monaco, Consolas, "Liberation Mono", monospace;
      --diffs-fg-number-override: rgba(255, 255, 255, 0.34);
    }
    pre {
      min-height: 100%;
    }
    [data-column-number] {
      padding-right: 14px;
      background: transparent;
      border-right: 1px solid rgba(255, 255, 255, 0.08);
    }
    [data-code] {
      padding-block: 12px;
    }
    [data-line] {
      padding-inline: 14px 18px;
    }
  `,
};

export function ProjectFileCodeView({
  path,
  content,
  className,
}: ProjectFileCodeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<PierreFile | null>(null);
  const file = useMemo<FileContents>(
    () => ({
      cacheKey: `${path}:${content.length}`,
      contents: content,
      name: path,
    }),
    [content, path],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    rendererRef.current ??= new PierreFile(codeViewerOptions);
    rendererRef.current.render({ containerWrapper: container, file });
  }, [file]);

  useEffect(
    () => () => {
      rendererRef.current?.cleanUp();
      rendererRef.current = null;
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className={cn("project-file-code-view min-h-0 flex-1 overflow-auto bg-background/25", className)}
    />
  );
}
