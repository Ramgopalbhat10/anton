import path from "node:path";

import { tool, type JSONValue } from "ai";
import { z } from "zod";

import type { AgentRunProfile } from "../loop";
import {
  ensureWorkspaceRoot,
  ensureWorkspaceRootAt,
} from "../sandbox";
import {
  detectPackageManager,
  readPackageJson,
  runScriptCommand,
  type PackageManager,
} from "./package-manager";
import { runWorkspaceProcess } from "./process";
import {
  compactVerifyForModel,
  verifyDefaultsForProfile,
} from "./model-output";

const MAX_TIMEOUT_MS = 300_000;
const MODEL_OUTPUT_TEXT_CAP = 8_000;
const PATH_HINT_CAP = 20;

const verificationTargetSchema = z.enum(["typecheck", "lint", "build"]);

export type VerificationTarget = z.infer<typeof verificationTargetSchema>;

export type VerificationStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "command_broken";

export type VerificationFailureScope =
  | "edited_file"
  | "unrelated"
  | "unknown";

export type VerificationRecommendedNext =
  | "final"
  | "fix_edited_file"
  | "report_unrelated"
  | "report_skipped"
  | "report_command_broken";

export type VerificationPathHint = {
  path: string;
  line?: number;
  column?: number;
};

export type VerificationPlan =
  | {
      ok: true;
      packageManager: PackageManager;
      steps: VerificationStep[];
    }
  | { ok: false; error: string };

export type VerificationStep = {
  target: VerificationTarget;
  scriptName: string;
  command?: string[];
  skipped: boolean;
  reason?: string;
};

type VerificationResult =
  | {
      target: VerificationTarget;
      skipped: true;
      ok: true;
      reason: string;
    }
  | {
      target: VerificationTarget;
      skipped: false;
      ok: boolean;
      command?: string;
      exitCode?: number;
      timedOut?: boolean;
      stdout?: string;
      stderr?: string;
      error?: string;
      commandBroken?: boolean;
    };

type CreateVerifyToolOptions = {
  getEditedPaths?: () => readonly string[];
};

const DEFAULT_TARGETS: readonly VerificationTarget[] = [
  "typecheck",
  "lint",
  "build",
];

export function createVerifyTool(
  workspaceRoot?: string,
  profile: AgentRunProfile = "general-chat",
  options: CreateVerifyToolOptions = {},
) {
  const defaults = verifyDefaultsForProfile(profile);
  return tool({
    description:
      "Run the repository's available verification scripts after edits. Detects the package manager and runs typecheck, lint, and build scripts when present. Requires approval.",
    inputSchema: z.object({
      targets: z
        .array(verificationTargetSchema)
        .min(1)
        .optional()
        .describe("Verification targets to run. Defaults to profile-aware targets."),
      timeoutMs: z
        .number()
        .int()
        .min(1_000)
        .max(MAX_TIMEOUT_MS)
        .optional()
        .describe(
          `Per-command timeout in milliseconds. Defaults to ${defaults.timeoutMs}ms for this profile.`,
        ),
    }),
    toModelOutput: ({ output }) => ({
      type: "json",
      value: compactVerifyForModel(output) as JSONValue,
    }),
    execute: async ({ targets, timeoutMs }) => {
      const root = workspaceRoot
        ? ensureWorkspaceRootAt(workspaceRoot)
        : ensureWorkspaceRoot();
      const editedPaths = normalizeUniquePaths(options.getEditedPaths?.() ?? []);
      const resolvedTargets =
        targets ??
        defaultTargetsForProfile(root, profile) ??
        defaults.targets ??
        DEFAULT_TARGETS;
      const plan = planVerification(root, {
        targets: resolvedTargets,
      });
      if (!plan.ok) {
        return buildVerificationOutput({
          editedPaths,
          packageManager: undefined,
          results: [],
          planError: plan.error,
          workspaceRoot: root,
        });
      }

      const results: VerificationResult[] = [];
      for (const step of plan.steps) {
        if (step.skipped || !step.command) {
          results.push({
            target: step.target,
            skipped: true,
            ok: true,
            reason: step.reason ?? "No matching package script found.",
          });
          continue;
        }

        const [file, ...args] = step.command;
        if (!file) {
          results.push({
            target: step.target,
            skipped: false,
            ok: false,
            error: "Verification command is empty.",
            commandBroken: true,
          });
          break;
        }

        const result = await runWorkspaceProcess(file, args, root, {
          timeoutMs: timeoutMs ?? defaults.timeoutMs,
        });
        const ok = result.exitCode === 0;
        results.push({
          target: step.target,
          skipped: false,
          ok,
          command: step.command.join(" "),
          exitCode: result.exitCode,
          timedOut: result.timedOut ?? false,
          stdout: capOutput(result.stdout),
          stderr: capOutput(result.stderr),
          ...(result.failedToStart ? { commandBroken: true as const } : {}),
          ...(ok
            ? {}
            : {
                error:
                  result.stderr ||
                  result.stdout ||
                  (result.timedOut
                    ? "Verification command timed out."
                    : "Verification command failed."),
              }),
        });
        if (!ok) break;
      }

      return buildVerificationOutput({
        editedPaths,
        packageManager: plan.packageManager,
        results,
        workspaceRoot: root,
      });
    },
  });
}

function buildVerificationOutput(input: {
  editedPaths: readonly string[];
  packageManager: PackageManager | undefined;
  results: readonly VerificationResult[];
  planError?: string;
  workspaceRoot: string;
}) {
  const ranCount = input.results.filter((result) => !result.skipped).length;
  const failed = input.results.filter((result) => !result.ok);
  const status = verificationStatus(input.results, input.planError);
  const failedText = failed
    .map((result) => failedResultText(result))
    .filter((text) => text.length > 0)
    .join("\n");
  const pathHints = extractPathHints(
    failedText,
    input.editedPaths,
    input.workspaceRoot,
  );
  const failureScope = failureScopeForHints(pathHints, input.editedPaths);
  const recommendedNext = recommendedNextForStatus(status, failureScope);
  const failureSummary = failureSummaryForStatus({
    status,
    failed,
    planError: input.planError,
    pathHints,
  });

  return {
    ok: status === "passed" || status === "skipped",
    status,
    failureScope,
    recommendedNext,
    editedPaths: input.editedPaths,
    pathHints,
    ...(failureSummary ? { failureSummary } : {}),
    ...(input.packageManager ? { packageManager: input.packageManager } : {}),
    ranCount,
    skippedCount: input.results.length - ranCount,
    results: input.results,
    summary:
      status === "passed"
        ? `Verification passed for ${ranCount} target${ranCount === 1 ? "" : "s"}.`
        : status === "skipped"
          ? (input.planError ?? "No verification scripts were available.")
          : status === "command_broken"
            ? "Verification command could not be executed."
            : `Verification failed for ${failed.length} target${failed.length === 1 ? "" : "s"}.`,
  };
}

function verificationStatus(
  results: readonly VerificationResult[],
  planError: string | undefined,
): VerificationStatus {
  if (planError) return "skipped";
  const ran = results.filter((result) => !result.skipped);
  if (ran.length === 0) return "skipped";
  if (ran.some((result) => !result.ok && result.commandBroken === true)) {
    return "command_broken";
  }
  if (ran.some((result) => !result.ok)) return "failed";
  return "passed";
}

function recommendedNextForStatus(
  status: VerificationStatus,
  failureScope: VerificationFailureScope,
): VerificationRecommendedNext {
  if (status === "passed") return "final";
  if (status === "skipped") return "report_skipped";
  if (status === "command_broken") return "report_command_broken";
  if (failureScope === "edited_file") return "fix_edited_file";
  if (failureScope === "unrelated") return "report_unrelated";
  return "final";
}

function failureScopeForHints(
  pathHints: readonly VerificationPathHint[],
  editedPaths: readonly string[],
): VerificationFailureScope {
  if (pathHints.length === 0) return "unknown";
  const edited = new Set(editedPaths.map(normalizeToolPath));
  return pathHints.some((hint) => edited.has(normalizeToolPath(hint.path)))
    ? "edited_file"
    : "unrelated";
}

function failureSummaryForStatus(input: {
  status: VerificationStatus;
  failed: readonly VerificationResult[];
  planError?: string;
  pathHints: readonly VerificationPathHint[];
}): string | undefined {
  if (input.status === "passed") return undefined;
  if (input.status === "skipped") {
    return input.planError ?? "No verification scripts were available.";
  }
  const firstFailed = input.failed.find((result) => !result.skipped);
  if (!firstFailed || firstFailed.skipped) return undefined;
  const text = failedResultText(firstFailed);
  const primaryLine = firstMeaningfulLine(text);
  const hint = input.pathHints[0];
  const location = hint
    ? `${hint.path}${hint.line !== undefined ? `:${hint.line}` : ""}${
        hint.column !== undefined ? `:${hint.column}` : ""
      }`
    : undefined;
  const prefix =
    input.status === "command_broken"
      ? "Verification command could not be executed"
      : "Verification failed";
  if (location && primaryLine) return `${prefix} at ${location}: ${primaryLine}`;
  if (primaryLine) return `${prefix}: ${primaryLine}`;
  return prefix;
}

function failedResultText(result: VerificationResult): string {
  if (result.skipped) return result.reason;
  return [result.stderr, result.stdout, result.error]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");
}

function firstMeaningfulLine(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^>/.test(trimmed)) continue;
    return trimmed.length > 240 ? `${trimmed.slice(0, 240)}...` : trimmed;
  }
  return undefined;
}

function extractPathHints(
  text: string,
  editedPaths: readonly string[],
  workspaceRoot: string,
): VerificationPathHint[] {
  const hints: VerificationPathHint[] = [];
  const seen = new Set<string>();
  const editedBasenames = new Set(
    editedPaths.map((editedPath) => path.posix.basename(normalizeToolPath(editedPath))),
  );
  const regex =
    /((?:[A-Za-z]:)?(?:[./\\]|\w)[\w .@()[\]/\\-]*\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|md|mdx|yml|yaml))(?:[:(](\d+))?(?::(\d+))?/g;

  for (const match of text.matchAll(regex)) {
    const rawPath = match[1];
    if (!rawPath) continue;
    const normalized = normalizeHintPath(rawPath, workspaceRoot);
    if (!normalized) continue;
    const basename = path.posix.basename(normalized);
    if (
      normalized.includes("node_modules/") &&
      !editedBasenames.has(basename)
    ) {
      continue;
    }
    const line = parsePositiveInt(match[2]);
    const column = parsePositiveInt(match[3]);
    const key = `${normalized}:${line ?? ""}:${column ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push({
      path: normalized,
      ...(line !== undefined ? { line } : {}),
      ...(column !== undefined ? { column } : {}),
    });
    if (hints.length >= PATH_HINT_CAP) break;
  }
  return hints;
}

function normalizeHintPath(value: string, workspaceRoot: string): string | undefined {
  const trimmed = value
    .replace(/^file:\/\//, "")
    .replace(/^["'`([{<]+/, "")
    .replace(/[)"'`>\],;]+$/, "")
    .replace(/\\/g, "/");
  const withoutDot = trimmed.replace(/^\.\//, "");
  if (withoutDot.length === 0) return undefined;
  if (isAbsolutePath(withoutDot)) {
    const relative = path.win32.isAbsolute(withoutDot)
      ? path.win32.relative(workspaceRoot, withoutDot)
      : path.posix.relative(workspaceRoot.replace(/\\/g, "/"), withoutDot);
    if (!relative.startsWith("..") && !isAbsolutePath(relative)) {
      return normalizeToolPath(relative);
    }
  }
  return normalizeToolPath(withoutDot);
}

function normalizeUniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map(normalizeToolPath).filter(Boolean))];
}

function normalizeToolPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized;
}

function isAbsolutePath(value: string): boolean {
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function defaultTargetsForProfile(
  workspaceRoot: string,
  profile: AgentRunProfile,
): readonly VerificationTarget[] | undefined {
  if (profile !== "localized-edit") return undefined;
  const packageJson = readPackageJson(workspaceRoot);
  if (!packageJson.ok) return ["lint"];
  const scripts = packageJson.value.scripts ?? {};
  const hasTypecheck =
    typeof scripts.typecheck === "string" ||
    typeof scripts["type-check"] === "string";
  return hasTypecheck ? ["typecheck"] : ["lint"];
}

function capOutput(value: string): string {
  if (value.length <= MODEL_OUTPUT_TEXT_CAP) return value;
  return `${value.slice(0, MODEL_OUTPUT_TEXT_CAP).trimEnd()}\n...[truncated ${value.length - MODEL_OUTPUT_TEXT_CAP} chars]`;
}

export const verifyTool = createVerifyTool();

export function planVerification(
  workspaceRoot: string | undefined,
  input: { targets?: readonly VerificationTarget[] },
): VerificationPlan {
  const root = workspaceRoot ?? process.cwd();
  const packageJson = readPackageJson(root);
  if (!packageJson.ok) return packageJson;

  const packageManager = detectPackageManager(root, packageJson.value);
  const scripts = packageJson.value.scripts ?? {};
  const targets = input.targets?.length ? input.targets : DEFAULT_TARGETS;
  return {
    ok: true,
    packageManager,
    steps: targets.map((target) => {
      const scriptName = scriptNameForTarget(target, scripts);
      if (!scriptName) {
        return {
          target,
          scriptName: target,
          skipped: true,
          reason: `No package.json script found for ${target}.`,
        };
      }
      return {
        target,
        scriptName,
        command: runScriptCommand(packageManager, scriptName),
        skipped: false,
      };
    }),
  };
}

function scriptNameForTarget(
  target: VerificationTarget,
  scripts: Record<string, unknown>,
): string | undefined {
  if (typeof scripts[target] === "string") return target;
  if (target === "typecheck" && typeof scripts["type-check"] === "string") {
    return "type-check";
  }
  return undefined;
}
