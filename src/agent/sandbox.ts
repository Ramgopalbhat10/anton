import path from "node:path";
import fs from "node:fs";

let cachedRoot: string | null = null;
let rootReady = false;

export function getWorkspaceRoot(): string {
  if (cachedRoot === null) {
    const raw = process.env.WORKSPACE_ROOT ?? "./workspace";
    cachedRoot = path.resolve(raw);
  }
  return cachedRoot;
}

export function ensureWorkspaceRoot(): string {
  const root = getWorkspaceRoot();
  if (rootReady) return root;
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  rootReady = true;
  return root;
}

export function ensureWorkspaceRootAt(rootPath: string): string {
  const root = path.resolve(rootPath);
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return root;
}

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export function resolveInWorkspace(
  inputPath: string,
  workspaceRoot?: string,
): string {
  const root = workspaceRoot
    ? ensureWorkspaceRootAt(workspaceRoot)
    : ensureWorkspaceRoot();
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new SandboxError("path must be a non-empty string");
  }
  if (path.isAbsolute(inputPath)) {
    throw new SandboxError(
      `absolute paths are not allowed: ${inputPath}. Use a path relative to the workspace root.`,
    );
  }

  const resolved = path.resolve(root, inputPath);
  if (!isInside(resolved, root)) {
    throw new SandboxError(`path escapes workspace root: ${inputPath}`);
  }

  // Resolve symlinks on any existing ancestor and verify the real path stays
  // inside the workspace. We walk upwards until we find a segment that exists
  // because the target itself may not exist yet (e.g. when writing a new file).
  const realAncestor = realpathOfExistingAncestor(resolved);
  if (!isInside(realAncestor, fs.realpathSync(root))) {
    throw new SandboxError(
      `path resolves outside workspace via symlink: ${inputPath}`,
    );
  }

  return resolved;
}

export function workspaceRelative(absPath: string): string {
  const rel = path.relative(getWorkspaceRoot(), absPath);
  return rel === "" ? "." : rel;
}

export function workspaceRelativeTo(rootPath: string, absPath: string): string {
  const rel = path.relative(path.resolve(rootPath), absPath);
  return rel === "" ? "." : rel;
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function realpathOfExistingAncestor(target: string): string {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fs.realpathSync(current);
}
