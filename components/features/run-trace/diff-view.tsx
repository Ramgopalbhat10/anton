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
  diffIndicators: "classic",
  disableFileHeader: true,
  disableLineNumbers: true,
  hunkSeparators: "metadata",
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
      --diffs-bg-context-gutter: color-mix(in oklch, var(--muted) 40%, transparent);
      --diffs-bg-separator: color-mix(in oklch, var(--muted) 46%, transparent);
      --diffs-bg-buffer: color-mix(in oklch, var(--muted-foreground) 12%, transparent);
      --diffs-addition-base: oklch(0.76 0.16 153);
      --diffs-deletion-base: var(--destructive);
      --diffs-selection-base: var(--primary);
      --diffs-gap-block: 0;
      --diffs-gap-inline: 0;
    }

    [data-code] {
      max-width: 100%;
      background: transparent;
    }

    [data-line],
    [data-column-number],
    [data-no-newline] {
      min-height: 1.25rem;
      padding-inline: 0.5rem;
    }

    [data-indicators="classic"] [data-line] {
      padding-inline-start: 1.5rem;
    }

    [data-separator="metadata"] {
      height: 1.5rem;
    }

    [data-separator="metadata"] [data-separator-wrapper] {
      color: var(--muted-foreground);
      background-color: color-mix(in oklch, var(--muted) 44%, transparent);
      font-size: 10px;
    }
  `,
} satisfies NonNullable<DiffBasePropsReact<undefined>["options"]>;

export function DiffView({
  previous,
  next,
  newFile,
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
    <DiffFrame
      className={className}
      header={
        <>
          <span>diff</span>
          {newFile ? <span className="text-emerald-400">new file</span> : null}
        </>
      }
    >
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
  header,
}: {
  children: ReactNode;
  className?: string;
  header?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-hidden rounded-md bg-background/70 font-mono text-[10px] leading-relaxed ring-1 ring-border",
        className,
      )}
    >
      {header ? (
        <div className="flex items-center gap-3 border-b border-border px-2 py-1 text-[10px] uppercase text-muted-foreground">
          {header}
        </div>
      ) : null}
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
