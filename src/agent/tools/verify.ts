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
const DEFAULT_BUILD_TIMEOUT_MS = MAX_TIMEOUT_MS;
const MODEL_OUTPUT_TEXT_CAP = 8_000;

const verificationTargetSchema = z.enum(["typecheck", "lint", "build"]);

export type VerificationTarget = z.infer<typeof verificationTargetSchema>;

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
      timeoutMs?: number;
      exitCode?: number;
      timedOut?: boolean;
      stdout?: string;
      stderr?: string;
      error?: string;
    };

const DEFAULT_TARGETS: readonly VerificationTarget[] = [
  "typecheck",
  "lint",
  "build",
];

export function createVerifyTool(
  workspaceRoot?: string,
  profile: AgentRunProfile = "general-chat",
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
          `Per-command timeout in milliseconds. Defaults to ${defaults.timeoutMs}ms for typecheck/lint and ${DEFAULT_BUILD_TIMEOUT_MS}ms for build in this profile.`,
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
      const resolvedTargets =
        targets ??
        defaultTargetsForProfile(root, profile) ??
        defaults.targets ??
        DEFAULT_TARGETS;
      const plan = planVerification(root, {
        targets: resolvedTargets,
      });
      if (!plan.ok) return plan;

      const results = await Promise.all(
        plan.steps.map(async (step): Promise<VerificationResult> => {
          if (step.skipped || !step.command) {
            return {
              target: step.target,
              skipped: true,
              ok: true,
              reason: step.reason ?? "No matching package script found.",
            };
          }

          const [file, ...args] = step.command;
          const stepTimeoutMs = timeoutForTarget(
            step.target,
            defaults.timeoutMs,
            timeoutMs,
          );
          if (!file) {
            return {
              target: step.target,
              skipped: false,
              ok: false,
              timeoutMs: stepTimeoutMs,
              error: "Verification command is empty.",
            };
          }

          const result = await runWorkspaceProcess(file, args, root, {
            timeoutMs: stepTimeoutMs,
          });
          const ok = result.exitCode === 0;
          return {
            target: step.target,
            skipped: false,
            ok,
            command: step.command.join(" "),
            timeoutMs: stepTimeoutMs,
            exitCode: result.exitCode,
            timedOut: result.timedOut ?? false,
            stdout: capOutput(result.stdout),
            stderr: capOutput(result.stderr),
            ...(ok
              ? {}
              : {
                  error: result.timedOut
                    ? `Verification command timed out after ${formatDuration(stepTimeoutMs)}.`
                    : result.stderr ||
                      result.stdout ||
                      "Verification command failed.",
                }),
          };
        }),
      );

      const ranCount = results.filter((result) => !result.skipped).length;
      const failed = results.filter((result) => !result.ok);
      return {
        ok: failed.length === 0,
        packageManager: plan.packageManager,
        parallel: true,
        ranCount,
        skippedCount: results.length - ranCount,
        results,
        summary:
          ranCount === 0
            ? "No verification scripts were available."
            : failed.length === 0
              ? `Verification passed for ${ranCount} target${ranCount === 1 ? "" : "s"}.`
              : `Verification failed for ${failed.length} target${failed.length === 1 ? "" : "s"}.`,
      };
    },
  });
}

function timeoutForTarget(
  target: VerificationTarget,
  defaultTimeoutMs: number,
  requestedTimeoutMs: number | undefined,
): number {
  if (requestedTimeoutMs !== undefined) return requestedTimeoutMs;
  if (target === "build") return Math.max(defaultTimeoutMs, DEFAULT_BUILD_TIMEOUT_MS);
  return defaultTimeoutMs;
}

function formatDuration(timeoutMs: number): string {
  if (timeoutMs % 1_000 !== 0) return `${timeoutMs}ms`;
  return `${timeoutMs / 1_000}s`;
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
