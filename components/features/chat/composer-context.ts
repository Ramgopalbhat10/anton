"use client";

import type { FileUIPart } from "ai";

import type {
  ComposerSkillSummary,
  ProjectFileTreeSummary,
} from "@/src/lib/api-types";
import type { AntonWorkspaceReference } from "@/src/lib/trace";

export type ComposerSendPayload = {
  text: string;
  references: AntonWorkspaceReference[];
  files: FileUIPart[];
};

export type ComposerTrigger = {
  kind: "slash" | "workspace";
  start: number;
  end: number;
  query: string;
};

export type ComposerSuggestion =
  | {
      kind: "slash";
      id: string;
      primary: string;
      secondary: string;
      source: ComposerSkillSummary["source"];
      command: string;
    }
  | {
      kind: "workspace";
      id: string;
      primary: string;
      secondary: string;
      reference: AntonWorkspaceReference;
    };

export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 24 * 1024 * 1024;

const SUGGESTION_LIMIT = 12;
const IMAGE_MEDIA_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MEDIA_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/typescript",
  "application/x-javascript",
  "application/javascript",
  "application/xml",
  "text/css",
  "text/csv",
  "text/html",
  "text/javascript",
  "text/jsx",
  "text/markdown",
  "text/plain",
  "text/tsx",
  "text/typescript",
  "text/x-markdown",
  "text/xml",
  "text/yaml",
  "text/x-yaml",
  "application/yaml",
  "application/x-yaml",
]);
const MIME_BY_EXTENSION: Record<string, string> = {
  ".avif": "image/avif",
  ".c": "text/plain",
  ".cpp": "text/plain",
  ".cs": "text/plain",
  ".css": "text/css",
  ".csv": "text/csv",
  ".go": "text/plain",
  ".gif": "image/gif",
  ".h": "text/plain",
  ".hpp": "text/plain",
  ".html": "text/html",
  ".java": "text/plain",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jsx": "text/jsx",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".mjs": "text/javascript",
  ".pdf": "application/pdf",
  ".php": "text/plain",
  ".png": "image/png",
  ".ps1": "text/plain",
  ".py": "text/plain",
  ".rb": "text/plain",
  ".rs": "text/plain",
  ".scss": "text/css",
  ".sh": "text/plain",
  ".sql": "text/plain",
  ".toml": "text/plain",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xml": "text/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
};

export const ATTACHMENT_ACCEPT = [
  ...IMAGE_MEDIA_TYPES,
  ...MEDIA_TYPES,
  ...Object.keys(MIME_BY_EXTENSION),
].join(",");

export function findComposerTrigger(
  text: string,
  caret: number | null | undefined,
): ComposerTrigger | null {
  if (caret === null || caret === undefined) return null;
  if (caret < 0 || caret > text.length) return null;

  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) start -= 1;

  const token = text.slice(start, caret);
  if (token.length === 0) return null;
  const marker = token[0];
  if (marker !== "/" && marker !== "@") return null;
  if (start > 0 && !/\s/.test(text[start - 1] ?? "")) return null;

  return {
    kind: marker === "/" ? "slash" : "workspace",
    start,
    end: caret,
    query: token.slice(1).toLowerCase(),
  };
}

export function skillSuggestions(
  skills: ComposerSkillSummary[],
  query: string,
): ComposerSuggestion[] {
  const normalizedQuery = query.toLowerCase();
  return skills
    .filter((skill) => {
      if (!normalizedQuery) return true;
      return [
        skill.command,
        skill.name,
        skill.description,
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    })
    .slice(0, SUGGESTION_LIMIT)
    .map((skill) => ({
      kind: "slash",
      id: `slash:${skill.command}`,
      primary: skill.command,
      secondary: skill.description || skill.name,
      source: skill.source,
      command: skill.command,
    }));
}

export function workspaceSuggestions(
  fileTree: ProjectFileTreeSummary | null,
  query: string,
  selected: AntonWorkspaceReference[],
): ComposerSuggestion[] {
  if (!fileTree) return [];

  const normalizedQuery = query.toLowerCase();
  const selectedKeys = new Set(
    selected.map((reference) => `${reference.kind}:${reference.path}`),
  );
  const directories = fileTree.directories.map((directory) => ({
    kind: "directory" as const,
    path: directory,
    label: directoryName(directory),
  }));
  const files = fileTree.paths.map((filePath) => ({
    kind: "file" as const,
    path: filePath,
    label: fileName(filePath),
  }));

  return [...directories, ...files]
    .filter((reference) => {
      if (selectedKeys.has(`${reference.kind}:${reference.path}`)) return false;
      if (!normalizedQuery) return true;
      return reference.path.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, SUGGESTION_LIMIT)
    .map((reference) => ({
      kind: "workspace",
      id: `workspace:${reference.kind}:${reference.path}`,
      primary:
        reference.kind === "directory"
          ? `${reference.label}/`
          : reference.label,
      secondary: reference.path,
      reference,
    }));
}

export async function appendAttachmentFiles(
  current: FileUIPart[],
  incoming: FileList | File[],
): Promise<{ files: FileUIPart[]; error: string | null }> {
  const source = Array.from(incoming);
  if (source.length === 0) return { files: current, error: null };
  if (current.length + source.length > MAX_ATTACHMENT_COUNT) {
    return {
      files: current,
      error: `Maximum ${MAX_ATTACHMENT_COUNT} attachments per message.`,
    };
  }

  let totalBytes = current.reduce(
    (sum, file) => sum + (attachmentDataUrlBytes(file.url) ?? 0),
    0,
  );
  const next = [...current];

  for (const file of source) {
    const mediaType = mediaTypeForFile(file);
    if (!mediaType) {
      return {
        files: current,
        error: `Unsupported file type: ${file.name || "unnamed file"}.`,
      };
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return {
        files: current,
        error: `${file.name || "Attachment"} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
      };
    }
    totalBytes += file.size;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      return {
        files: current,
        error: `Attachments exceed the ${formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)} total limit.`,
      };
    }
    next.push({
      type: "file",
      mediaType,
      filename: file.name || "attachment",
      url: await readFileAsDataUrl(file),
    });
  }

  return { files: next, error: null };
}

export function isImageFilePart(file: FileUIPart): boolean {
  return IMAGE_MEDIA_TYPES.has(file.mediaType.toLowerCase());
}

export function attachmentDisplayName(file: FileUIPart): string {
  return file.filename?.trim() || "Attachment";
}

export function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}

function mediaTypeForFile(file: File): string | undefined {
  const extension = extensionForFile(file.name);
  const byExtension = extension ? MIME_BY_EXTENSION[extension] : undefined;
  if (byExtension) return byExtension;

  const mediaType = file.type.toLowerCase();
  if (IMAGE_MEDIA_TYPES.has(mediaType) || MEDIA_TYPES.has(mediaType)) {
    return mediaType;
  }
  return undefined;
}

function extensionForFile(name: string): string | undefined {
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1) return undefined;
  return name.slice(lastDot).toLowerCase();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read attachment"));
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsDataURL(file);
  });
}

function attachmentDataUrlBytes(url: string): number | undefined {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(url);
  if (!match) return undefined;
  const isBase64 = match[2] !== undefined;
  const payload = match[3] ?? "";
  if (isBase64) {
    const normalized = payload.replace(/\s/g, "");
    const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).length;
  } catch {
    return new TextEncoder().encode(payload).length;
  }
}

function fileName(filePath: string): string {
  return filePath.split("/").at(-1) ?? filePath;
}

function directoryName(directory: string): string {
  return directory.split("/").at(-1) ?? directory;
}
