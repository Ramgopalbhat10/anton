"use client";

import { useState } from "react";
import type { FileUIPart } from "ai";
import {
  Code2,
  File,
  FileJson,
  FileText,
  Folder,
  Image as ImageIcon,
  Paperclip,
  Sparkles,
  X,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { AntonWorkspaceReference } from "@/src/lib/trace";
import {
  attachmentDisplayName,
  isImageFilePart,
  type ComposerSuggestion,
} from "./composer-context";

export function ComposerSuggestionPopover({
  suggestions,
  activeIndex,
  onSelect,
  className,
}: {
  suggestions: ComposerSuggestion[];
  activeIndex: number;
  onSelect: (suggestion: ComposerSuggestion) => void;
  className?: string;
}) {
  if (suggestions.length === 0) return null;

  return (
    <div
      className={cn(
        "absolute bottom-full left-0 z-50 mb-2 w-full max-w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-[10px] bg-popover text-popover-foreground shadow-[0_12px_32px_rgba(0,0,0,0.35)] ring-1 ring-border",
        className,
      )}
    >
      <div
        role="listbox"
        aria-label="Composer suggestions"
        className="max-h-64 overflow-y-auto p-1.5"
      >
        {suggestions.map((suggestion, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={suggestion.id}
              type="button"
              role="option"
              aria-selected={active}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left outline-none",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(suggestion);
              }}
            >
              <SuggestionIcon suggestion={suggestion} />
              <span className="grid min-w-0 flex-1 gap-px">
                <span className="truncate font-mono text-[12.5px] leading-4 text-foreground">
                  {suggestion.primary}
                </span>
                <span className="truncate text-[11.5px] leading-4 text-muted-foreground">
                  {suggestion.secondary}
                </span>
              </span>
              {suggestion.kind === "slash" ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                  {suggestion.source}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function WorkspaceReferencePill({
  reference,
  removable = false,
  onRemove,
  className,
}: {
  reference: AntonWorkspaceReference;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "group/ref inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-[11.5px] font-medium text-secondary-foreground ring-1 ring-border/70",
        className,
      )}
    >
      {reference.kind === "directory" ? (
        <Folder className="size-3 shrink-0 text-muted-foreground" />
      ) : (
        <FileText className="size-3 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 truncate font-mono">
        {reference.kind === "directory" ? `${reference.path}/` : reference.path}
      </span>
      {removable ? (
        <button
          type="button"
          className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/30 group-hover/ref:opacity-100"
          aria-label={`Remove ${reference.path}`}
          onClick={onRemove}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

export function WorkspaceReferenceTray({
  references,
  removable,
  onRemove,
  className,
}: {
  references: AntonWorkspaceReference[];
  removable?: boolean;
  onRemove?: (reference: AntonWorkspaceReference) => void;
  className?: string;
}) {
  if (references.length === 0) return null;
  return (
    <div className={cn("flex min-w-0 flex-wrap gap-1.5", className)}>
      {references.map((reference) => (
        <WorkspaceReferencePill
          key={`${reference.kind}:${reference.path}`}
          reference={reference}
          removable={removable}
          onRemove={() => onRemove?.(reference)}
        />
      ))}
    </div>
  );
}

export function AttachmentTray({
  files,
  removable,
  onRemove,
  className,
}: {
  files: FileUIPart[];
  removable?: boolean;
  onRemove?: (file: FileUIPart, index: number) => void;
  className?: string;
}) {
  const [preview, setPreview] = useState<FileUIPart | null>(null);
  if (files.length === 0) return null;

  return (
    <>
      <div className={cn("flex min-w-0 flex-wrap gap-1.5", className)}>
        {files.map((file, index) => (
          <AttachmentPreview
            key={`${file.url.slice(0, 80)}:${index}`}
            file={file}
            removable={removable}
            onRemove={() => onRemove?.(file, index)}
            onOpenImage={() => setPreview(file)}
          />
        ))}
      </div>
      <ImageLightbox file={preview} onOpenChange={setPreview} />
    </>
  );
}

export function AttachmentPreview({
  file,
  removable = false,
  onRemove,
  onOpenImage,
  className,
}: {
  file: FileUIPart;
  removable?: boolean;
  onRemove?: () => void;
  onOpenImage?: () => void;
  className?: string;
}) {
  const image = isImageFilePart(file);
  const name = attachmentDisplayName(file);
  return (
    <span
      className={cn(
        "group/attachment relative inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-[11.5px] font-medium text-secondary-foreground ring-1 ring-border/70",
        image && "pl-1",
        className,
      )}
    >
      {image ? (
        <button
          type="button"
          className="relative size-8 shrink-0 overflow-hidden rounded bg-muted outline-none ring-1 ring-border/70 focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={onOpenImage}
          aria-label={`Preview ${name}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={file.url}
            alt={name}
            className="h-full w-full object-cover"
          />
        </button>
      ) : (
        <AttachmentIcon file={file} />
      )}
      <span className="grid min-w-0">
        <span className="truncate">{name}</span>
        {!image ? (
          <span className="truncate text-[10.5px] font-normal text-muted-foreground">
            {file.mediaType}
          </span>
        ) : null}
      </span>
      {removable ? (
        <button
          type="button"
          className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-popover text-muted-foreground opacity-0 shadow-sm ring-1 ring-border outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/30 group-hover/attachment:opacity-100"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

function ImageLightbox({
  file,
  onOpenChange,
}: {
  file: FileUIPart | null;
  onOpenChange: (file: FileUIPart | null) => void;
}) {
  const name = file ? attachmentDisplayName(file) : "Image preview";
  return (
    <AlertDialog open={file !== null} onOpenChange={(open) => {
      if (!open) onOpenChange(null);
    }}>
      <AlertDialogContent className="!max-w-[min(94vw,960px)] gap-0 bg-popover p-2">
        <AlertDialogTitle className="sr-only">{name}</AlertDialogTitle>
        <AlertDialogDescription className="sr-only">
          Attached image preview.
        </AlertDialogDescription>
        {file ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={file.url}
              alt={name}
              className="max-h-[82vh] w-auto max-w-full rounded-lg object-contain"
            />
            <AlertDialogCancel
              size="icon-sm"
              className="absolute right-2 top-2 bg-popover/85 text-foreground backdrop-blur-sm"
              aria-label="Close preview"
            >
              <X className="size-3.5" />
            </AlertDialogCancel>
          </div>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SuggestionIcon({ suggestion }: { suggestion: ComposerSuggestion }) {
  if (suggestion.kind === "slash") {
    return <Sparkles className="size-3.5 shrink-0 text-primary" />;
  }
  return suggestion.reference.kind === "directory" ? (
    <Folder className="size-3.5 shrink-0 text-muted-foreground" />
  ) : (
    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
  );
}

function AttachmentIcon({ file }: { file: FileUIPart }) {
  const mediaType = file.mediaType.toLowerCase();
  if (mediaType.includes("json")) {
    return <FileJson className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (
    mediaType.includes("javascript") ||
    mediaType.includes("typescript") ||
    mediaType.includes("css") ||
    mediaType.includes("html")
  ) {
    return <Code2 className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (mediaType.includes("image")) {
    return <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (mediaType.includes("text") || mediaType.includes("pdf")) {
    return <FileText className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (mediaType.includes("csv")) {
    return <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <File className="size-3.5 shrink-0 text-muted-foreground" />;
}
