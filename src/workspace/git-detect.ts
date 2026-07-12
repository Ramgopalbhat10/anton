import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Returns true when `root` is inside a Git work tree. */
export function isGitRepositoryAt(root: string): boolean {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) return false;

  try {
    const stdout = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: resolved,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}
