"use client";

import { useMemo } from "react";
import { File } from "@pierre/diffs/react";
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
      display: block;
      width: 100%;
      min-width: max-content;
      max-width: none;
      --project-file-code-surface: var(--background);
      --diffs-bg: var(--project-file-code-surface);
      --diffs-dark-bg: var(--project-file-code-surface);
      --diffs-dark: #ededed;
      --diffs-font-size: 11px;
      --diffs-line-height: 19px;
      --diffs-font-family: var(--font-jetbrains-mono), "SF Mono", Monaco, Consolas, "Liberation Mono", monospace;
      --diffs-fg-number-override: var(--text-tertiary);
      --diffs-gap-block: 0;
      --diffs-gap-inline: 0;
    }
    [data-code] {
      width: 100%;
      min-width: max-content;
      max-width: none;
      padding-block: 10px 14px;
      overflow: visible;
      background: transparent;
    }
    [data-code]::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
    [data-gutter] {
      z-index: 5;
      background-color: var(--project-file-code-surface);
    }
    [data-overflow="scroll"] [data-gutter] {
      position: sticky;
      left: 0;
    }
    [data-column-number] {
      min-width: 2.5ch;
      padding-inline: 0.5rem 0.75rem;
      font-size: 10px;
      background-color: var(--project-file-code-surface);
    }
    [data-line-number-content] {
      min-width: 2.5ch;
    }
    [data-line] {
      padding-inline: 0.5rem 0.875rem;
    }
  `,
};

export function ProjectFileCodeView({
  path,
  content,
  className,
}: ProjectFileCodeViewProps) {
  const file = useMemo<FileContents>(
    () => ({
      cacheKey: `${path}:${content.length}`,
      contents: content,
      name: path,
    }),
    [content, path],
  );

  return (
    <div
      className={cn(
        "project-file-code-view anton-diff-scrollbar min-h-0 flex-1 overflow-auto bg-[var(--project-file-code-surface)]",
        className,
      )}
    >
      <File
        file={file}
        options={codeViewerOptions}
        className="block min-w-0 w-full max-w-none"
      />
    </div>
  );
}
