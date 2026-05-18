"use client";

import { useMemo, type ReactNode } from "react";
import {
  MultiFileDiff,
  PatchDiff,
  type DiffBasePropsReact,
  type FileContents,
} from "@pierre/diffs/react";

import { cn } from "@/lib/utils";

interface DiffViewProps {
  previous: string;
  next: string;
  newFile?: boolean;
  filename?: string;
  className?: string;
}

interface PatchDiffViewProps {
  patch: string | null;
  filename: string;
  previousFilename?: string | null;
  status?: string;
  className?: string;
}

const COMPACT_DIFF_OPTIONS = {
  theme: { light: "pierre-light", dark: "pierre-dark" },
  themeType: "dark",
  diffStyle: "unified",
  diffIndicators: "bars",
  disableFileHeader: true,
  disableLineNumbers: false,
  hunkSeparators: "line-info-basic",
  lineDiffType: "word",
  maxLineDiffLength: 500,
  overflow: "scroll",
  tokenizeMaxLineLength: 500,
  unsafeCSS: `
    :host {
      display: block;
      min-width: 0;
      max-width: 100%;
      color: var(--foreground);
      background: transparent;
      font-family: var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 10px;
      line-height: 1.45;
      --diffs-bg: transparent;
      --diffs-fg: var(--foreground);
      --diffs-fg-number: color-mix(in oklch, var(--muted-foreground) 72%, transparent);
      --diffs-bg-context: transparent;
      --diffs-bg-context-gutter: color-mix(in oklch, var(--muted) 34%, transparent);
      --diffs-bg-separator: color-mix(in oklch, var(--muted) 42%, transparent);
      --diffs-bg-buffer: color-mix(in oklch, var(--muted-foreground) 12%, transparent);
      --diffs-addition-base: oklch(0.76 0.16 153);
      --diffs-deletion-base: var(--destructive);
      --diffs-selection-base: var(--primary);
      --diffs-gap-block: 0;
      --diffs-gap-inline: 0;
      --diffs-scrollbar-gutter-override: 10px;
      --diffs-min-number-column-width: 4ch;
    }

    [data-code] {
      max-width: 100%;
      background: transparent;
      overflow-x: auto;
      overflow-y: clip;
      scrollbar-color: color-mix(in oklch, var(--foreground) 16%, transparent) transparent;
    }

    [data-code]::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }

    [data-code]::-webkit-scrollbar-thumb {
      border: 3px solid transparent;
      border-radius: 999px;
      background: color-mix(in oklch, var(--foreground) 16%, transparent);
      background-clip: padding-box;
    }

    [data-code]::-webkit-scrollbar-thumb:hover {
      border: 3px solid transparent;
      background: color-mix(in oklch, var(--foreground) 24%, transparent);
      background-clip: padding-box;
    }

    [data-code]::-webkit-scrollbar-track,
    [data-code]::-webkit-scrollbar-corner {
      background: transparent;
    }

    [data-line],
    [data-column-number],
    [data-no-newline] {
      min-height: 1.25rem;
      padding-inline: 0.375rem;
    }

    [data-column-number] {
      min-width: 4ch;
      padding-inline: 0.5rem 0.375rem;
      color: color-mix(in oklch, var(--muted-foreground) 72%, transparent);
    }

    [data-line-number-content] {
      min-width: 4ch;
    }

    [data-separator="line-info-basic"] {
      height: 1.125rem;
      min-height: 1.125rem;
    }

    [data-separator="line-info-basic"] [data-separator-wrapper] {
      border-radius: 0.25rem;
      color: var(--muted-foreground);
      background-color: color-mix(in oklch, var(--muted) 50%, transparent);
      font-size: 10px;
      line-height: 1.125rem;
    }

    [data-separator="line-info-basic"] [data-separator-content] {
      height: 1.125rem;
      padding-inline: 0.5ch;
    }
  `,
} satisfies NonNullable<DiffBasePropsReact<undefined>["options"]>;

export function DiffView({
  previous,
  next,
  filename = "diff.txt",
  className,
}: DiffViewProps) {
  const oldFile = useMemo(
    () => fileContents(filename, previous, "old"),
    [filename, previous],
  );
  const newFileContents = useMemo(
    () => fileContents(filename, next, "new"),
    [filename, next],
  );

  if (previous === next) {
    return <DiffFallback>No changes.</DiffFallback>;
  }

  return (
    <DiffFrame className={className}>
      <MultiFileDiff
        oldFile={oldFile}
        newFile={newFileContents}
        options={COMPACT_DIFF_OPTIONS}
        className="block min-w-0 max-w-full"
      />
    </DiffFrame>
  );
}

export function PatchDiffView({
  patch,
  filename,
  previousFilename,
  status,
  className,
}: PatchDiffViewProps) {
  const normalizedPatch = useMemo(
    () =>
      patch
        ? normalizePatchForPierre({
            patch,
            filename,
            previousFilename,
            status,
          })
        : null,
    [filename, patch, previousFilename, status],
  );

  if (!normalizedPatch) {
    return <DiffFallback>Diff preview unavailable for this file.</DiffFallback>;
  }

  return (
    <DiffFrame className={className}>
      <PatchDiff
        patch={normalizedPatch}
        options={COMPACT_DIFF_OPTIONS}
        className="block min-w-0 max-w-full"
      />
    </DiffFrame>
  );
}

function DiffFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-hidden rounded-md bg-background/70 font-mono text-[10px] leading-relaxed ring-1 ring-border",
        className,
      )}
    >
      <div className="min-w-0 max-w-full overflow-hidden">{children}</div>
    </div>
  );
}

function DiffFallback({ children }: { children: ReactNode }) {
  return (
    <div className="rounded bg-background/60 px-3 py-2 text-[11px] text-muted-foreground ring-1 ring-border">
      {children}
    </div>
  );
}

function fileContents(
  filename: string,
  contents: string,
  side: "old" | "new",
): FileContents {
  return {
    name: filename,
    contents,
    cacheKey: `${side}:${filename}:${contents.length}:${hashString(contents)}`,
  };
}

function normalizePatchForPierre({
  patch,
  filename,
  previousFilename,
  status,
}: {
  patch: string;
  filename: string;
  previousFilename?: string | null;
  status?: string;
}): string {
  if (/^diff --git /m.test(patch) || /^---\s/m.test(patch)) {
    return patch;
  }

  const currentPath = normalizePatchPath(filename);
  const oldPath = normalizePatchPath(previousFilename ?? filename);
  const isAdded = status === "added";
  const isDeleted = status === "removed" || status === "deleted";
  const oldHeader = isAdded ? "/dev/null" : `a/${oldPath}`;
  const newHeader = isDeleted ? "/dev/null" : `b/${currentPath}`;

  return [
    `diff --git a/${oldPath} b/${currentPath}`,
    `--- ${oldHeader}`,
    `+++ ${newHeader}`,
    patch,
  ].join("\n");
}

function normalizePatchPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(31, hash) + value.charCodeAt(i);
  }
  return String(hash >>> 0);
}
