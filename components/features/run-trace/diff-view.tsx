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
  variant?: "framed" | "embedded";
}

const COMPACT_DIFF_BASE_CSS = `
  :host {
    display: block;
    min-width: 0;
    width: 100%;
    min-width: max-content;
    max-width: none;
    color: var(--foreground);
    background: transparent;
    font-family: var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 10px;
    line-height: 1.45;
    --diffs-bg: var(--background);
    --diffs-fg: var(--foreground);
    --diffs-fg-number: color-mix(in oklch, var(--muted-foreground) 72%, transparent);
    --diffs-bg-context: transparent;
    --diffs-bg-context-gutter: color-mix(in oklch, var(--muted) 34%, transparent);
    --diffs-bg-separator: color-mix(in oklch, var(--muted) 42%, transparent);
    --diffs-bg-buffer: color-mix(in oklch, var(--muted-foreground) 12%, transparent);
    --diffs-addition-base: var(--success);
    --diffs-deletion-base: var(--destructive);
    --diffs-selection-base: var(--primary);
    --diffs-bg-addition-override: color-mix(in oklab, var(--background) 90%, var(--success));
    --diffs-bg-deletion-override: color-mix(in oklab, var(--background) 90%, var(--destructive));
    --diffs-bg-addition-emphasis-override: color-mix(in oklab, var(--background) 78%, var(--success));
    --diffs-bg-deletion-emphasis-override: color-mix(in oklab, var(--background) 78%, var(--destructive));
    --diffs-fg-number-addition-override: color-mix(in oklch, var(--muted-foreground) 72%, transparent);
    --diffs-fg-number-deletion-override: color-mix(in oklch, var(--muted-foreground) 72%, transparent);
    --diffs-gap-block: 0;
    --diffs-gap-inline: 0;
    --diffs-scrollbar-gutter-override: 10px;
    --diffs-min-number-column-width: 4ch;
  }

  [data-code] {
    width: 100%;
    min-width: max-content;
    max-width: none;
    background: transparent;
    overflow: visible;
    padding-bottom: 0;
  }

  [data-code]::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  [data-gutter] {
    z-index: 5;
    background-color: var(--diffs-bg);
    box-shadow: none;
  }

  [data-overflow="scroll"] [data-gutter] {
    position: relative;
    left: auto;
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
`;

const PR_EMBEDDED_HUNK_SEPARATOR_CSS = `
  [data-separator="line-info-basic"] {
    height: 24px;
    position: relative;
  }

  /*
   * Pierre renders separator markup in every gutter/content row. Target the
   * left gutter only, following https://diffs.com/docs#hunk-separators
   */
  [data-diff-type="single"] [data-gutter] [data-separator-wrapper] {
    position: absolute;
    left: 100%;
    display: flex;
    align-items: center;
    gap: unset;
    width: max-content;
    background: transparent;
    color: var(--diffs-fg-number);
    font-family: var(--diffs-header-font-family, var(--diffs-header-font-fallback));
    font-size: 0.6875rem;
    margin-left: calc(-2ch - 2px);
  }

  [data-diff-type="single"] [data-gutter] [data-separator-wrapper][data-separator-multi-button] {
    margin-left: calc(-3ch - 2px);
  }

  [data-diff-type="single"] [data-gutter] [data-expand-button],
  [data-diff-type="single"] [data-gutter] [data-separator-content] {
    display: block;
    align-self: unset;
    min-width: unset;
    min-height: unset;
    padding: 0;
    flex-shrink: 0;
    grid-column: unset;
    border: none;
    width: auto;
    height: auto;
    background-color: unset;
    color: inherit;
    font: inherit;
  }

  [data-diff-type="single"] [data-gutter] [data-expand-button]:not([data-expand-all-button]) svg {
    display: none;
  }

  [data-diff-type="single"] [data-gutter] [data-expand-button][data-expand-down]::before {
    content: "↑";
  }

  [data-diff-type="single"] [data-gutter] [data-expand-button][data-expand-up]::before {
    content: "↓";
  }

  [data-diff-type="single"] [data-gutter] [data-expand-button][data-expand-both]::before {
    content: "↕";
  }

  [data-diff-type="single"] [data-gutter] [data-separator-content] {
    background: transparent;
    margin-left: calc(2px + 1ch);
  }

  [data-diff-type="single"] [data-gutter] [data-separator-content]:hover,
  [data-diff-type="single"] [data-gutter] [data-expand-button]:hover,
  [data-diff-type="single"] [data-gutter] [data-expand-all-button]:hover {
    color: var(--diffs-fg);
  }

  [data-diff-type="single"] [data-gutter] [data-expand-all-button] {
    position: relative;
    margin-left: 14px;
    text-transform: lowercase;
  }

  [data-diff-type="single"] [data-gutter] [data-expand-all-button]:hover {
    text-decoration: underline;
  }

  [data-diff-type="single"] [data-gutter] [data-expand-all-button]::before {
    content: "";
    display: block;
    position: absolute;
    top: 50%;
    left: -8px;
    margin-top: -1px;
    width: 3px;
    height: 3px;
    border-radius: 2px;
    background-color: var(--diffs-fg-number);
    pointer-events: none;
  }
`;

const PR_EMBEDDED_DIFF_CSS = `
  :host {
    display: block;
    min-width: 0;
    width: 100%;
    min-width: max-content;
    max-width: none;
    color: var(--muted-foreground);
    background: transparent;
    font-family: var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 10.5px;
    line-height: 1.45;
    --diffs-bg: var(--card);
    --diffs-fg: var(--muted-foreground);
    --diffs-fg-number: var(--text-tertiary);
    --diffs-bg-context: var(--card);
    --diffs-bg-context-gutter: var(--card);
    --diffs-bg-separator: var(--input);
    --diffs-bg-separator-override: var(--input);
    --diffs-bg-buffer: color-mix(in oklch, var(--muted-foreground) 10%, var(--card));
    --diffs-addition-base: var(--success);
    --diffs-deletion-base: var(--destructive);
    --diffs-selection-base: var(--primary);
    --diffs-bg-addition-override: color-mix(in oklab, var(--success) 13%, var(--card));
    --diffs-bg-deletion-override: color-mix(in oklab, var(--destructive) 13%, var(--card));
    --diffs-bg-addition-emphasis-override: color-mix(in oklab, var(--success) 30%, var(--card));
    --diffs-bg-deletion-emphasis-override: color-mix(in oklab, var(--destructive) 30%, var(--card));
    --diffs-fg-addition-override: color-mix(in oklch, var(--success) 62%, var(--foreground));
    --diffs-fg-deletion-override: color-mix(in oklch, var(--destructive) 62%, var(--foreground));
    --diffs-fg-number-addition-override: var(--text-tertiary);
    --diffs-fg-number-deletion-override: var(--text-tertiary);
    --diffs-gap-block: 0;
    --diffs-gap-inline: 0;
    --diffs-min-number-column-width: 26px;
    --diffs-indicator-width-override: 2px;
    --diffs-header-font-family: var(--font-sans, system-ui, sans-serif);
  }

  [data-code] {
    width: 100%;
    min-width: max-content;
    max-width: none;
    background: transparent;
    overflow: visible;
    padding: 0;
  }

  [data-code]::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  [data-gutter] {
    z-index: 3;
    background-color: var(--card);
    box-shadow: none;
  }

  [data-gutter] [data-column-number],
  [data-gutter] [data-gutter-buffer] {
    background-color: var(--diffs-line-bg, var(--card));
  }

  [data-content] {
    background-color: transparent;
  }

  [data-line] {
    min-height: auto;
    padding-block: 2px;
    padding-inline: 10px 6px;
  }

  [data-column-number] {
    width: 26px;
    min-width: 26px;
    max-width: 26px;
    padding-inline: 0;
    font-size: 9.5px;
    text-align: right;
    color: var(--text-tertiary);
  }

  [data-line-number-content] {
    min-width: 26px;
  }

  ${PR_EMBEDDED_HUNK_SEPARATOR_CSS}
`;

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
  unsafeCSS: COMPACT_DIFF_BASE_CSS,
} satisfies NonNullable<DiffBasePropsReact<undefined>["options"]>;

const PR_EMBEDDED_PATCH_DIFF_OPTIONS = {
  ...COMPACT_DIFF_OPTIONS,
  unsafeCSS: PR_EMBEDDED_DIFF_CSS,
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
  variant = "framed",
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

  const options =
    variant === "embedded" ? PR_EMBEDDED_PATCH_DIFF_OPTIONS : COMPACT_DIFF_OPTIONS;
  const diff = (
    <PatchDiff
      patch={normalizedPatch}
      options={options}
      className="block min-w-0 max-w-full"
    />
  );

  if (variant === "embedded") {
    return (
      <div
        className={cn(
          "min-w-0 max-w-full overflow-hidden bg-transparent",
          className,
        )}
      >
        <div className="anton-diff-scrollbar min-w-0 max-w-full overflow-x-auto overflow-y-hidden">
          {diff}
        </div>
      </div>
    );
  }

  return <DiffFrame className={className}>{diff}</DiffFrame>;
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
      <div className="anton-diff-scrollbar min-w-0 max-w-full overflow-x-auto overflow-y-hidden">
        {children}
      </div>
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
