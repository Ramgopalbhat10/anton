import fs from "node:fs";
import path from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type PackageJson = {
  packageManager?: string;
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};

export function readPackageJson(
  root: string,
): { ok: true; value: PackageJson } | { ok: false; error: string } {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) {
    return { ok: false, error: "No package.json found in the workspace root." };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      return { ok: false, error: "package.json must contain an object." };
    }
    return { ok: true, value: parsed as PackageJson };
  } catch (err) {
    return { ok: false, error: `Failed to read package.json: ${errorMessage(err)}` };
  }
}

export function detectPackageManager(
  root: string,
  packageJson: PackageJson,
): PackageManager {
  const declared = packageJson.packageManager?.split("@")[0];
  if (isPackageManager(declared)) return declared;
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(root, "bun.lock")) || fs.existsSync(path.join(root, "bun.lockb"))) {
    return "bun";
  }
  return "npm";
}

export function runScriptCommand(
  packageManager: PackageManager,
  scriptName: string,
  args: readonly string[] = [],
): string[] {
  const base =
    packageManager === "npm"
      ? ["npm", "run", scriptName]
      : [packageManager, "run", scriptName];
  return args.length > 0 ? [...base, "--", ...args] : base;
}

export function execCommand(
  packageManager: PackageManager,
  args: readonly string[],
): string[] {
  if (packageManager === "npm") return ["npm", "exec", "--", ...args];
  return [packageManager, "exec", ...args];
}

export function hasDependency(packageJson: PackageJson, name: string): boolean {
  return dependencyRecordHas(packageJson.dependencies, name) ||
    dependencyRecordHas(packageJson.devDependencies, name);
}

export function scriptNames(packageJson: PackageJson): string[] {
  return Object.entries(packageJson.scripts ?? {})
    .filter(([, command]) => typeof command === "string")
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

export function dependencyNames(packageJson: PackageJson): string[] {
  return [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ].sort((a, b) => a.localeCompare(b));
}

function dependencyRecordHas(
  dependencies: Record<string, unknown> | undefined,
  name: string,
): boolean {
  return dependencies !== undefined && Object.prototype.hasOwnProperty.call(dependencies, name);
}

function isPackageManager(value: string | undefined): value is PackageManager {
  return value === "npm" || value === "pnpm" || value === "yarn" || value === "bun";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
