import type { AgentRunProfile } from "./loop";
import {
  evaluateFastEditPromotion,
  singleFileEditHandoff,
  type ProfilePromotionEvent,
  type PromotionTriggerInput,
} from "./profile-promotion";
import { localizedEditToolNames } from "./profile-classifier";
import { readFileOutputIsFullCoverage, extractVerifyFailureSummary } from "./tools/model-output";

export type ToolPolicyPhase =
  | "explore"
  | "recoverEdit"
  | "postEdit"
  | "verify"
  | "final";

export type LoopGuardBlockedOutput = {
  ok: false;
  code: "LOOP_GUARD_BLOCKED";
  message: string;
  phase?: ToolPolicyPhase;
  failureCode?: string;
  affectedPath?: string;
  recommendedNext?:
    | "verify"
    | "edit_text"
    | "replace_text"
    | "replace_lines"
    | "read_file"
    | "final";
};

export type PriorToolCallRecord = {
  toolName: string;
  input: unknown;
  output: unknown;
  success: boolean;
};

export type ToolPolicySeed = {
  phase?: ToolPolicyPhase;
  readCountsByPath?: Record<string, number>;
  readCountsByPathRange?: Record<string, number>;
  lastHashByPath?: Record<string, string>;
  lastSuccessfulEdit?: { path: string; nextHash: string };
  failedEditsByPath?: Record<string, number>;
  multiReplaceBlockedKeys?: string[];
  recoveryReadUsedByPath?: string[];
  verifyCompleted?: boolean;
  verifyFixPending?: boolean;
  verifyRecoveryUsed?: boolean;
  lastVerifyFailureSummary?: string;
  editedPaths?: string[];
  promoted?: boolean;
};

const STATE_CHANGING_TOOLS = new Set([
  "edit_file",
  "edit_text",
  "replace_text",
  "replace_lines",
  "multi_replace_text",
  "write_file",
]);

const MAP_CAP = 128;

const EXPLORATION_ONLY_TOOLS = new Set(["grep", "glob"]);

const LOCALIZED_EDIT_TOOL_SET = new Set<string>(localizedEditToolNames());
const SINGLE_FILE_EDIT_TOOL_SET = new Set<string>([
  "read_file",
  "edit_text",
  "verify",
]);

const EXPLORATION_BEFORE_VERIFY = new Set([
  "grep",
  "glob",
  "inspect_project",
  "delegate_task",
  "remember_memory",
  "forget_memory",
  "list_memory",
  "read_dir",
]);

const PROFILES_REQUIRING_VERIFY: ReadonlySet<AgentRunProfile> = new Set([
  "localized-edit",
  "single-file-edit",
  "general-chat",
  "accepted-plan-simple",
  "accepted-plan-general",
  "approval-continuation",
]);

const PROFILES_PREFER_EDIT_TEXT: ReadonlySet<AgentRunProfile> = new Set([
  "localized-edit",
  "single-file-edit",
  "accepted-plan-simple",
]);

const PROFILES_BLOCK_WRITE_FILE_REPLACEMENT: ReadonlySet<AgentRunProfile> = new Set([
  "localized-edit",
  "single-file-edit",
  "accepted-plan-simple",
]);

export class ToolPolicyEngine {
  private phase: ToolPolicyPhase = "explore";
  private readCountsByPath = new Map<string, number>();
  private readCountsByPathRange = new Map<string, number>();
  private searchCounts = new Map<string, number>();
  private failedEditsByPath = new Map<string, number>();
  private semanticToolCounts = new Map<string, number>();
  private pendingSemanticKeys = new Set<string>();
  private lastHashByPath = new Map<string, string>();
  private lastReadHashByRange = new Map<string, string>();
  private lastSuccessfulEdit: { path: string; nextHash: string } | undefined;
  private multiReplaceBlockedKeys = new Set<string>();
  private recoveryReadAllowedByPath = new Set<string>();
  private recoveryReadUsedByPath = new Set<string>();
  private lastFailedEditCodeByPath = new Map<string, string>();
  private fullCoveragePaths = new Set<string>();
  private partialReadPaths = new Set<string>();
  private distinctPathsRead = new Set<string>();
  private editFileBlockedPaths = new Set<string>();
  private searchStepsBeforeEdit = 0;
  private promoted = false;
  private promotionEvent: ProfilePromotionEvent | undefined;
  private blockedAttemptCount = 0;
  private guardCount = 0;
  private stepsWithoutStateChange = 0;
  private stateChangingToolCount = 0;
  private forceFinalReason: string | undefined;
  private processedStepCount = 0;
  private hadStateChangingSuccess = false;
  private emittedGuardReasons = new Set<string>();
  private verifyCompleted = false;
  private verifyNudgeCount = 0;
  private verifyFixPending = false;
  private verifyFixNoteCount = 0;
  private verifyRecoveryUsed = false;
  private lastVerifyFailureSummary: string | undefined;
  private editedPaths = new Set<string>();
  private pendingStaleReadNote: string | undefined;
  private editTextFailedPaths = new Set<string>();
  private readonly requireVerifyAfterEdit: boolean;
  private readonly targetPath: string | undefined;
  private targetRead = false;
  private singleFileRecoveryReadAttempts = 0;

  constructor(
    private readonly profile: AgentRunProfile,
    options: { targetPath?: string } = {},
  ) {
    this.requireVerifyAfterEdit = PROFILES_REQUIRING_VERIFY.has(profile);
    this.targetPath = options.targetPath ? normalizeToolPath(options.targetPath) : undefined;
  }

  get loopGuardCount(): number {
    return this.guardCount;
  }

  get currentPhase(): ToolPolicyPhase {
    return this.phase;
  }

  get promotionReason(): string | undefined {
    return this.promotionEvent?.reason;
  }

  get wasPromoted(): boolean {
    return this.promoted;
  }

  get endedWithoutStateChange(): boolean {
    if (this.profile === "single-file-edit" && !this.hadStateChangingSuccess) {
      return true;
    }
    return (
      this.hadStateChangingSuccess === false &&
      (this.forceFinalReason !== undefined || this.blockedAttemptCount >= 3)
    );
  }

  get endedUnverified(): boolean {
    return (
      this.requireVerifyAfterEdit &&
      this.hadStateChangingSuccess &&
      !this.verifyCompleted &&
      !this.verifyFixPending
    );
  }

  get endedWithFailedVerification(): boolean {
    return (
      this.requireVerifyAfterEdit &&
      this.hadStateChangingSuccess &&
      this.verifyFixPending
    );
  }

  get needsVerify(): boolean {
    return (
      this.requireVerifyAfterEdit &&
      this.hadStateChangingSuccess &&
      !this.verifyCompleted
    );
  }

  getEditedPathsSnapshot(): string[] {
    return [...this.editedPaths];
  }

  consumeVerifyReminder(): string | undefined {
    if (!this.needsVerify || this.verifyNudgeCount >= 3) return undefined;
    if (this.verifyFixPending && this.lastVerifyFailureSummary) return undefined;
    this.verifyNudgeCount += 1;
    return [
      "Verification required:",
      "At least one file edit succeeded in this run.",
      "Run the verify tool once before writing the final answer.",
      "Use edit_text for fixups; avoid re-reading whole files unless a targeted range is needed.",
    ].join(" ");
  }

  consumeStaleReadNote(): string | undefined {
    const note = this.pendingStaleReadNote;
    this.pendingStaleReadNote = undefined;
    return note;
  }

  consumeVerifyFixNote(): string | undefined {
    if (!this.verifyFixPending || !this.lastVerifyFailureSummary) return undefined;
    if (this.verifyFixNoteCount >= 3) return undefined;
    this.verifyFixNoteCount += 1;
    const paths = [...this.editedPaths];
    const pathHint =
      paths.length > 0
        ? ` Fix the edited file(s): ${paths.map((p) => `\`${p}\``).join(", ")}.`
        : "";
    return [
      "Verification failed:",
      this.lastVerifyFailureSummary,
      pathHint,
      "Use edit_text with a small fix at the reported line, then run verify again.",
      "Do not use bash, grep, or glob until the syntax/lint error is fixed.",
    ].join(" ");
  }

  needsVerifyFix(): boolean {
    return (
      this.requireVerifyAfterEdit &&
      this.hadStateChangingSuccess &&
      this.verifyFixPending
    );
  }

  seed(input: ToolPolicySeed | undefined): void {
    if (!input) return;
    if (input.phase) this.phase = input.phase;
    if (input.verifyCompleted === true) {
      this.verifyCompleted = true;
      if (this.phase === "postEdit") this.phase = "final";
    }
    if (input.promoted === true) {
      this.promoted = true;
    }
    if (input.lastSuccessfulEdit) {
      this.lastSuccessfulEdit = input.lastSuccessfulEdit;
      this.phase = "postEdit";
    }
    for (const [path, count] of Object.entries(input.readCountsByPath ?? {})) {
      this.readCountsByPath.set(path, count);
    }
    for (const [key, count] of Object.entries(input.readCountsByPathRange ?? {})) {
      this.readCountsByPathRange.set(key, count);
    }
    for (const [path, hash] of Object.entries(input.lastHashByPath ?? {})) {
      this.lastHashByPath.set(path, hash);
    }
    for (const [path, count] of Object.entries(input.failedEditsByPath ?? {})) {
      this.failedEditsByPath.set(path, count);
      if (count >= 2) {
        this.phase = "recoverEdit";
        this.recoveryReadAllowedByPath.add(path);
      }
    }
    for (const key of input.multiReplaceBlockedKeys ?? []) {
      this.multiReplaceBlockedKeys.add(key);
    }
    for (const path of input.recoveryReadUsedByPath ?? []) {
      this.recoveryReadUsedByPath.add(path);
    }
    if (input.verifyFixPending === true) {
      this.verifyFixPending = true;
      if (input.lastVerifyFailureSummary) {
        this.lastVerifyFailureSummary = input.lastVerifyFailureSummary;
      }
    }
    if (input.verifyRecoveryUsed === true) {
      this.verifyRecoveryUsed = true;
    }
    for (const path of input.editedPaths ?? []) {
      this.editedPaths.add(normalizeToolPath(path) ?? path);
    }
  }

  seedFromPriorToolHistory(records: readonly PriorToolCallRecord[]): void {
    for (const record of records) {
      this.observeToolCall(record.toolName, record.input);
      this.observeToolResult(record.toolName, record.input, record.output, record.success);
    }
  }

  observeSteps(
    steps: readonly {
      toolCalls?: readonly { toolName: string; input: unknown }[];
      toolResults?: readonly { toolName: string; output: unknown }[];
    }[],
  ): void {
    for (let index = this.processedStepCount; index < steps.length; index += 1) {
      this.observeStep(steps[index]);
    }
    this.processedStepCount = steps.length;
  }

  checkPromotion(
    effectiveTokensUsed: number,
    maxEffectiveTokens: number,
  ): ProfilePromotionEvent | undefined {
    if (this.promoted || this.promotionEvent) return this.promotionEvent;
    const event = evaluateFastEditPromotion(this.profile, this.promoted, {
      distinctPathsRead: this.distinctPathsRead.size,
      partialReadPaths: this.partialReadPaths.size,
      failedEditPaths: this.failedEditsByPath.size,
      searchStepsBeforeEdit: this.searchStepsBeforeEdit,
      effectiveTokensUsed,
      maxEffectiveTokens,
      hadSuccessfulEdit: this.hadStateChangingSuccess,
    });
    if (event) this.promotionEvent = event;
    return event;
  }

  markPromoted(): ProfilePromotionEvent | undefined {
    this.promoted = true;
    return this.promotionEvent;
  }

  promotionTriggerInput(
    effectiveTokensUsed: number,
    maxEffectiveTokens: number,
  ): PromotionTriggerInput {
    return {
      distinctPathsRead: this.distinctPathsRead.size,
      partialReadPaths: this.partialReadPaths.size,
      failedEditPaths: this.failedEditsByPath.size,
      searchStepsBeforeEdit: this.searchStepsBeforeEdit,
      effectiveTokensUsed,
      maxEffectiveTokens,
      hadSuccessfulEdit: this.hadStateChangingSuccess,
    };
  }

  checkBeforeExecute(
    toolName: string,
    input: unknown,
  ): LoopGuardBlockedOutput | undefined {
    if (this.forceFinalReason) {
      return blockedOutput(this.forceFinalReason, "final", {
        phase: this.phase,
      });
    }

    const semanticKey = `${toolName}:${stableJson(input)}`;
    if (
      this.pendingSemanticKeys.has(semanticKey) ||
      (this.semanticToolCounts.get(semanticKey) ?? 0) >= 1
    ) {
      this.recordBlockedAttempt();
      return blockedOutput(
        `The same \`${toolName}\` call repeated with identical input. Use the latest result instead of calling it again.`,
        recommendedForTool(toolName),
        { phase: this.phase, affectedPath: pathFromInput(input) },
      );
    }

    if (
      this.profile === "localized-edit" &&
      !this.promoted &&
      !LOCALIZED_EDIT_TOOL_SET.has(toolName)
    ) {
      this.recordBlockedAttempt();
      return blockedOutput(
        `Tool \`${toolName}\` is unavailable in fast-edit mode. Continue with read/search, edit_text, verify, or wait for profile handoff to full Agent.`,
        "edit_text",
        { phase: this.phase },
      );
    }

    if (this.profile === "single-file-edit") {
      const blocked = this.checkSingleFileEditBoundary(toolName, input);
      if (blocked) return blocked;
    }

    if (this.needsVerify && EXPLORATION_BEFORE_VERIFY.has(toolName)) {
      this.recordBlockedAttempt();
      const message = this.verifyFixPending
        ? "Broad exploration is blocked while verification is failing. Fix the reported error with edit_text, then run verify again."
        : "Broad exploration is blocked until verify runs after the latest edits. Run verify or make a targeted fixup edit first.";
      return blockedOutput(message, this.verifyFixPending ? "edit_text" : "verify", {
        phase: this.phase,
      });
    }

    if (this.needsVerifyFix()) {
      const path = pathFromInput(input);
      const normalizedPath = normalizeToolPath(path);
      if (
        toolName === "edit_text" &&
        normalizedPath &&
        !this.editedPaths.has(normalizedPath)
      ) {
        this.recordBlockedAttempt();
        return blockedOutput(
          `Verification recovery is limited to edited files. \`${path}\` was not edited in this run.`,
          "edit_text",
          { phase: this.phase, affectedPath: path },
        );
      }
      if (
        toolName === "bash" ||
        toolName === "grep" ||
        toolName === "glob" ||
        toolName === "inspect_project" ||
        toolName === "delegate_task" ||
        toolName === "edit_file" ||
        toolName === "replace_text" ||
        toolName === "replace_lines" ||
        toolName === "multi_replace_text" ||
        toolName === "write_file"
      ) {
        this.recordBlockedAttempt();
        return blockedOutput(
          "Verification failed on the last edit. Fix the reported syntax/lint error with edit_text, then run verify again.",
          "edit_text",
          { phase: this.phase },
        );
      }
    }

    if (toolName === "read_file") {
      const path = pathFromInput(input);
      const readKey = path ? readFileRangeKey(input, path) : undefined;
      const currentHash = path ? this.lastHashByPath.get(path) : undefined;

      if (
        path &&
        readKey &&
        currentHash &&
        this.lastReadHashByRange.get(readKey) === currentHash &&
        !this.recoveryReadAllowedByPath.has(path)
      ) {
        this.recordBlockedAttempt();
        return blockedOutput(
          `read_file for \`${path}\` at this range already returned content for hash ${currentHash.slice(0, 8)}…. Edit, verify, or read a different range instead of repeating the same read.`,
          "edit_text",
          {
            phase: this.phase,
            affectedPath: path,
          },
        );
      }

      if (
        path &&
        this.phase === "explore" &&
        !this.hadStateChangingSuccess &&
        this.fullCoveragePaths.has(path) &&
        isFullFileReadInput(input) &&
        !this.recoveryReadAllowedByPath.has(path)
      ) {
        this.recordBlockedAttempt();
        return blockedOutput(
          `Full file content for \`${path}\` is already available from a prior read. Edit or verify instead of re-reading the whole file.`,
          "edit_text",
          {
            phase: this.phase,
            affectedPath: path,
          },
        );
      }

      if (path && readKey) {
        const rangeReads = (this.readCountsByPathRange.get(readKey) ?? 0) + 1;
        if (
          this.profile === "localized-edit" &&
          !this.promoted &&
          this.phase === "explore" &&
          !this.hadStateChangingSuccess &&
          rangeReads > 2 &&
          !this.recoveryReadAllowedByPath.has(path)
        ) {
          this.recordBlockedAttempt();
          return blockedOutput(
            `Repeated reads of \`${path}\` at the same range are blocked before the first edit. Use the latest read_file result or switch to an edit tool.`,
            "edit_text",
            {
              phase: this.phase,
              affectedPath: path,
            },
          );
        }
      }
    }

    if (
      (toolName === "grep" || toolName === "glob") &&
      this.phase === "final"
    ) {
      this.recordBlockedAttempt();
      return blockedOutput(
        "Broad search is blocked after verification succeeded. Finish the answer.",
        "final",
        { phase: this.phase },
      );
    }

    if (toolName === "edit_file") {
      const path = pathFromInput(input);
      if (
        path &&
        PROFILES_PREFER_EDIT_TEXT.has(this.profile) &&
        !this.editTextFailedPaths.has(path) &&
        !this.editFileBlockedPaths.has(path)
      ) {
        this.recordBlockedAttempt();
        return blockedOutput(
          `Use edit_text for changes on \`${path}\`. If edit_text cannot express the change in this profile, continue through profile handoff to full Agent.`,
          "edit_text",
          {
            phase: this.phase,
            affectedPath: path,
          },
        );
      }
      if (path && this.editFileBlockedPaths.has(path)) {
        this.recordBlockedAttempt();
        return blockedOutput(
          `edit_file already failed on \`${path}\`. Retry with edit_text or continue through profile handoff to full Agent.`,
          "edit_text",
          {
            phase: this.phase,
            affectedPath: path,
          },
        );
      }
    }

    if (toolName === "write_file") {
      const path = pathFromInput(input);
      if (
        path &&
        PROFILES_BLOCK_WRITE_FILE_REPLACEMENT.has(this.profile) &&
        writeFileLooksLikeReplacement(input, this.lastHashByPath.has(path))
      ) {
        this.recordBlockedAttempt();
        return blockedOutput(
          `write_file replacement for existing path \`${path}\` is blocked in this edit-preferred profile. Use edit_text for targeted changes or continue through profile handoff to full Agent.`,
          "edit_text",
          {
            phase: this.phase,
            affectedPath: path,
          },
        );
      }
    }

    if (toolName === "multi_replace_text") {
      const path = pathFromInput(input);
      const hash = hashFromInput(input);
      const blockKey = path && hash ? `${path}:${hash}` : undefined;
      if (blockKey && this.multiReplaceBlockedKeys.has(blockKey)) {
        this.recordBlockedAttempt();
        return blockedOutput(
          `multi_replace_text already failed on \`${path}\` with the current hash. Re-read a targeted range, retry with edit_text, or continue through profile handoff.`,
          "edit_text",
          {
            phase: this.phase,
            affectedPath: path,
            failureCode: "FIND_NOT_FOUND",
          },
        );
      }
    }

    if (
      this.profile === "localized-edit" &&
      !this.promoted &&
      this.phase === "explore" &&
      this.stepsWithoutStateChange >= 8 &&
      this.stateChangingToolCount === 0 &&
      !STATE_CHANGING_TOOLS.has(toolName)
    ) {
      this.forceFinalReason =
        "Fast-edit exploration exceeded its step budget without a successful edit. Explain what is blocking progress or wait for profile promotion.";
      this.recordGuard();
      return blockedOutput(this.forceFinalReason, "edit_text", {
        phase: this.phase,
      });
    }

    return undefined;
  }

  private checkSingleFileEditBoundary(
    toolName: string,
    input: unknown,
  ): LoopGuardBlockedOutput | undefined {
    if (!this.targetPath) {
      return this.blockForSingleFileHandoff(
        "single-file-edit has no resolved target path; continuing requires general Agent routing.",
        toolName,
        input,
      );
    }

    if (!SINGLE_FILE_EDIT_TOOL_SET.has(toolName)) {
      return this.blockForSingleFileHandoff(
        `Tool \`${toolName}\` is unavailable in single-file-edit; continuing requires general Agent tools.`,
        toolName,
        input,
      );
    }

    const inputPath = pathFromInput(input);
    const normalizedInputPath = normalizeToolPath(inputPath);
    const pathTool = toolName === "read_file" || toolName === "edit_text";
    if (pathTool && normalizedInputPath !== this.targetPath) {
      return this.blockForSingleFileHandoff(
        `single-file-edit is locked to \`${this.targetPath}\`, but \`${toolName}\` targeted \`${inputPath ?? "unknown"}\`.`,
        toolName,
        input,
      );
    }

    if (toolName === "edit_text" && !this.targetRead) {
      this.recordBlockedAttempt();
      return blockedOutput(
        `Read \`${this.targetPath}\` with read_file before editing it.`,
        "read_file",
        { phase: this.phase, affectedPath: this.targetPath },
      );
    }

    if (toolName === "verify" && !this.hadStateChangingSuccess) {
      this.recordBlockedAttempt();
      return blockedOutput(
        `Edit \`${this.targetPath}\` with edit_text before verification.`,
        this.targetRead ? "edit_text" : "read_file",
        { phase: this.phase, affectedPath: this.targetPath },
      );
    }

    return undefined;
  }

  private blockForSingleFileHandoff(
    reason: string,
    toolName: string,
    input: unknown,
  ): LoopGuardBlockedOutput {
    this.promotionEvent = singleFileEditHandoff(reason);
    this.recordBlockedAttempt();
    return blockedOutput(reason, "final", {
      phase: this.phase,
      affectedPath: pathFromInput(input) ?? this.targetPath,
      failureCode:
        toolName === "read_file" || toolName === "edit_text"
          ? "SINGLE_FILE_TARGET_MISMATCH"
          : "SINGLE_FILE_TOOL_UNAVAILABLE",
    });
  }

  shouldForceFinal(): string | undefined {
    if (this.forceFinalReason) return this.forceFinalReason;
    if (this.blockedAttemptCount >= 3) {
      return "Repeated loop-guard blocks exhausted recovery attempts. Write the final answer with the latest tool results.";
    }
    return undefined;
  }

  recordPendingToolCall(toolName: string, input: unknown): void {
    const semanticKey = `${toolName}:${stableJson(input)}`;
    this.pendingSemanticKeys.add(semanticKey);
  }

  shouldEmitLoopGuardEvent(reason: string): boolean {
    if (this.emittedGuardReasons.has(reason)) return false;
    this.emittedGuardReasons.add(reason);
    return true;
  }

  loopGuardEventDetails(
    toolName: string,
    input: unknown,
    blocked: LoopGuardBlockedOutput,
  ): Record<string, unknown> {
    return {
      reason: blocked.message,
      blockedTools: [toolName],
      phase: blocked.phase ?? this.phase,
      ...(blocked.affectedPath ? { affectedPath: blocked.affectedPath } : {}),
      ...(blocked.failureCode ? { failureCode: blocked.failureCode } : {}),
      ...(blocked.recommendedNext
        ? { recommendedNext: blocked.recommendedNext }
        : {}),
      input,
    };
  }

  private observeStep(step: {
    toolCalls?: readonly { toolName: string; input: unknown }[];
    toolResults?: readonly { toolName: string; output: unknown }[];
  } | undefined): void {
    if (!step) return;
    this.pendingSemanticKeys.clear();
    const calls = step.toolCalls ?? [];
    const hadStateChange = calls.some(
      (call) =>
        STATE_CHANGING_TOOLS.has(call.toolName) &&
        !isLoopGuardBlockedOutput(
          step.toolResults?.find((result) => result.toolName === call.toolName)
            ?.output,
        ),
    );
    const hadExplorationOnly =
      calls.length > 0 &&
      calls.every((call) => EXPLORATION_ONLY_TOOLS.has(call.toolName));
    if (hadStateChange) {
      this.stepsWithoutStateChange = 0;
    } else if (hadExplorationOnly || calls.some((call) => call.toolName === "read_file")) {
      this.stepsWithoutStateChange += 1;
    }
    if (
      !this.hadStateChangingSuccess &&
      calls.some((call) => call.toolName === "grep" || call.toolName === "glob")
    ) {
      this.searchStepsBeforeEdit += 1;
    }
    for (const call of calls) {
      this.observeToolCall(call.toolName, call.input);
    }
    for (const result of step.toolResults ?? []) {
      const input =
        calls.find((call) => call.toolName === result.toolName)?.input ?? {};
      if (isLoopGuardBlockedOutput(result.output)) continue;
      this.observeToolResult(
        result.toolName,
        input,
        result.output,
        !isFailedOutput(result.output),
      );
    }
  }

  private observeToolCall(toolName: string, input: unknown): void {
    const semanticKey = `${toolName}:${stableJson(input)}`;
    incrementBounded(this.semanticToolCounts, semanticKey);

    if (toolName === "read_file") {
      const path = pathFromInput(input);
      if (path) {
        incrementBounded(this.readCountsByPath, path);
        this.distinctPathsRead.add(path);
        if (this.recoveryReadAllowedByPath.has(path)) {
          this.recoveryReadUsedByPath.add(path);
          this.recoveryReadAllowedByPath.delete(path);
        }
      }
    }
    if (toolName === "grep" || toolName === "glob") {
      const searchKey = searchKeyForCall(toolName, input);
      if (searchKey) incrementBounded(this.searchCounts, searchKey);
    }
  }

  private observeToolResult(
    toolName: string,
    input: unknown,
    output: unknown,
    success: boolean,
  ): void {
    if (success && toolName === "read_file" && isRecord(output)) {
      const path = typeof output.path === "string" ? output.path : pathFromInput(input);
      const hash = typeof output.sha256 === "string" ? output.sha256 : undefined;
      if (path && hash) this.lastHashByPath.set(path, hash);
      if (path) {
        if (
          this.profile === "single-file-edit" &&
          normalizeToolPath(path) === this.targetPath
        ) {
          this.targetRead = true;
        }
        this.distinctPathsRead.add(path);
        const readKey = readFileRangeKeyFromOutput(output, path);
        if (readKey) {
          incrementBounded(this.readCountsByPathRange, readKey);
          if (hash) this.lastReadHashByRange.set(readKey, hash);
        }
        if (readFileOutputIsFullCoverage(output)) {
          this.fullCoveragePaths.add(path);
          this.partialReadPaths.delete(path);
        } else {
          this.partialReadPaths.add(path);
        }
      }
    }

    if (
      success &&
      (toolName === "edit_text" ||
        toolName === "replace_text" ||
        toolName === "replace_lines" ||
        toolName === "multi_replace_text" ||
        toolName === "edit_file") &&
      isRecord(output) &&
      output.ok === true
    ) {
      const path = typeof output.path === "string" ? output.path : pathFromInput(input);
      const nextHash =
        typeof output.nextHash === "string" ? output.nextHash : undefined;
      if (path && nextHash) {
        if (this.verifyFixPending) {
          this.verifyRecoveryUsed = true;
        }
        this.lastSuccessfulEdit = { path, nextHash };
        this.lastHashByPath.set(path, nextHash);
        this.editedPaths.add(normalizeToolPath(path) ?? path);
        this.fullCoveragePaths.delete(path);
        for (const key of [...this.lastReadHashByRange.keys()]) {
          if (key.startsWith(`read_file:${path}:`)) {
            this.lastReadHashByRange.delete(key);
          }
        }
        this.phase = "postEdit";
        this.hadStateChangingSuccess = true;
        this.failedEditsByPath.delete(path);
        this.recoveryReadAllowedByPath.delete(path);
        this.recoveryReadUsedByPath.delete(path);
        this.lastFailedEditCodeByPath.delete(path);
        this.pendingStaleReadNote = [
          "File changed on disk:",
          `\`${path}\` hash is now ${nextHash.slice(0, 12)}….`,
          "Prior read_file content for this path is stale.",
          toolName === "edit_text"
            ? "Use the edit_text diff in the latest tool result for the next edit."
            : "Use edit_text for the next change, or read_file a targeted range if you must confirm JSX/imports.",
        ].join(" ");
      }
    }

    if (
      (toolName === "edit_file" ||
        toolName === "edit_text" ||
        toolName === "replace_text" ||
        toolName === "replace_lines" ||
        toolName === "multi_replace_text") &&
      isFailedOutput(output)
    ) {
      const path = pathFromInput(input);
      const failureCode =
        isRecord(output) && typeof output.code === "string"
          ? output.code
          : undefined;
      if (path) {
        incrementBounded(this.failedEditsByPath, path);
        if (failureCode) this.lastFailedEditCodeByPath.set(path, failureCode);
        if (toolName === "edit_text") {
          this.editTextFailedPaths.add(path);
        }
        const failures = this.failedEditsByPath.get(path) ?? 0;
        if (
          toolName === "multi_replace_text" &&
          failureCode === "FIND_NOT_FOUND"
        ) {
          const hash = hashFromInput(input);
          if (hash) this.multiReplaceBlockedKeys.add(`${path}:${hash}`);
        }
        if (
          toolName === "edit_file" &&
          (failureCode === "PATCH_PARSE_FAILED" ||
            failureCode === "PATCH_CONTEXT_FAILED")
        ) {
          this.editFileBlockedPaths.add(path);
        }
        if (
          this.profile === "single-file-edit" &&
          toolName === "edit_text" &&
          normalizeToolPath(path) === this.targetPath
        ) {
          const anchorFailure =
            failureCode === "FIND_NOT_FOUND" ||
            failureCode === "FIND_NOT_UNIQUE";
          if (anchorFailure && this.singleFileRecoveryReadAttempts === 0) {
            this.phase = "recoverEdit";
            this.singleFileRecoveryReadAttempts += 1;
            this.recoveryReadAllowedByPath.add(path);
          } else {
            this.promotionEvent = singleFileEditHandoff(
              `edit_text recovery failed for \`${path}\`; continuing requires general Agent tools.`,
            );
          }
        }
        if (failures >= 2 && failures < 3) {
          this.phase = "recoverEdit";
          this.recoveryReadAllowedByPath.add(path);
        }
        if (failures >= 3) {
          this.forceFinalReason = `Editing \`${path}\` failed ${failures} times. Stop and explain the blocker with the latest structured error.`;
          this.recordGuard();
        } else if (
          failures >= 2 &&
          this.recoveryReadUsedByPath.has(path)
        ) {
          this.forceFinalReason = `Editing \`${path}\` failed after a recovery re-read. Stop and explain the blocker with the latest structured error.`;
          this.recordGuard();
        }
      }
    }

    if (toolName === "verify" && isRecord(output)) {
      const status = typeof output.status === "string" ? output.status : undefined;
      const failureScope =
        typeof output.failureScope === "string" ? output.failureScope : undefined;
      const recoverableEditedFailure =
        status === "failed" &&
        failureScope === "edited_file" &&
        !this.verifyRecoveryUsed;

      if (output.ok === true || status === "passed" || status === "skipped") {
        this.verifyCompleted = true;
        this.verifyFixPending = false;
        this.verifyFixNoteCount = 0;
        this.lastVerifyFailureSummary = undefined;
        this.phase = "final";
        if (status === "skipped") {
          this.forceFinalReason =
            extractVerifyFailureSummary(output) ??
            "Verification was skipped. Write the final answer with that reason.";
        }
      } else if (recoverableEditedFailure) {
        this.verifyCompleted = false;
        this.verifyFixPending = true;
        this.phase = "recoverEdit";
        this.lastVerifyFailureSummary = extractVerifyFailureSummary(output);
        this.recoveryReadAllowedByPath.clear();
        for (const editedPath of this.editedPaths) {
          this.recoveryReadAllowedByPath.add(editedPath);
        }
      } else {
        this.verifyCompleted = true;
        this.verifyFixPending = false;
        this.verifyFixNoteCount = 0;
        this.phase = "final";
        this.lastVerifyFailureSummary = extractVerifyFailureSummary(output);
        this.forceFinalReason =
          this.lastVerifyFailureSummary ??
          "Verification did not pass. Write the final answer with the latest verification result.";
      }
    }

    if (STATE_CHANGING_TOOLS.has(toolName) && success) {
      this.stateChangingToolCount += 1;
      this.hadStateChangingSuccess = true;
    }
  }

  private recordBlockedAttempt(): void {
    this.blockedAttemptCount += 1;
    this.recordGuard();
    if (this.blockedAttemptCount >= 3 && !this.forceFinalReason) {
      this.forceFinalReason =
        "Repeated loop-guard blocks exhausted recovery attempts. Write the final answer with the latest tool results.";
    }
  }

  private recordGuard(): void {
    this.guardCount += 1;
  }
}

function isLoopGuardBlockedOutput(output: unknown): boolean {
  return isRecord(output) && output.code === "LOOP_GUARD_BLOCKED";
}

export function priorToolRecordsFromAssistantMessage(
  message: { parts: readonly { type: string; [key: string]: unknown }[] } | undefined,
): PriorToolCallRecord[] {
  if (!message) return [];
  const records: PriorToolCallRecord[] = [];
  for (const part of message.parts) {
    if (!part.type.startsWith("tool-")) continue;
    if (!("state" in part) || typeof part.state !== "string") continue;
    if (
      part.state !== "output-available" &&
      part.state !== "output-error" &&
      part.state !== "output-denied"
    ) {
      continue;
    }
    const toolName = part.type.slice("tool-".length);
    const input = "input" in part ? part.input : undefined;
    const output = "output" in part ? part.output : undefined;
    const success = part.state === "output-available" && !isFailedOutput(output);
    records.push({ toolName, input, output, success });
  }
  return records;
}

export function seedFromPriorToolRecords(
  records: readonly PriorToolCallRecord[],
): ToolPolicySeed {
  const readCountsByPath: Record<string, number> = {};
  const readCountsByPathRange: Record<string, number> = {};
  const lastHashByPath: Record<string, string> = {};
  const failedEditsByPath: Record<string, number> = {};
  const multiReplaceBlockedKeys: string[] = [];
  const recoveryReadUsedByPath: string[] = [];
  let lastSuccessfulEdit: { path: string; nextHash: string } | undefined;
  let phase: ToolPolicyPhase = "explore";
  let verifyFixPending = false;
  let verifyRecoveryUsed = false;
  let lastVerifyFailureSummary: string | undefined;
  const editedPaths = new Set<string>();

  for (const record of records) {
    if (record.toolName === "read_file" && record.success && isRecord(record.output)) {
      const path =
        typeof record.output.path === "string"
          ? record.output.path
          : pathFromInput(record.input);
      if (path) readCountsByPath[path] = (readCountsByPath[path] ?? 0) + 1;
      const readKey = path
        ? readFileRangeKeyFromOutput(record.output, path)
        : undefined;
      if (readKey) {
        readCountsByPathRange[readKey] = (readCountsByPathRange[readKey] ?? 0) + 1;
      }
      const hash =
        typeof record.output.sha256 === "string" ? record.output.sha256 : undefined;
      if (path && hash) lastHashByPath[path] = hash;
    }
    if (
      record.success &&
      (record.toolName === "edit_text" ||
        record.toolName === "replace_text" ||
        record.toolName === "replace_lines" ||
        record.toolName === "multi_replace_text" ||
        record.toolName === "edit_file") &&
      isRecord(record.output) &&
      record.output.ok === true
    ) {
      const path =
        typeof record.output.path === "string"
          ? record.output.path
          : pathFromInput(record.input);
      const nextHash =
        typeof record.output.nextHash === "string"
          ? record.output.nextHash
          : undefined;
      if (path && nextHash) {
        lastSuccessfulEdit = { path, nextHash };
        lastHashByPath[path] = nextHash;
        if (verifyFixPending) verifyRecoveryUsed = true;
        editedPaths.add(normalizeToolPath(path) ?? path);
        phase = "postEdit";
      }
    }
    if (
      record.toolName === "edit_text" &&
      isFailedOutput(record.output)
    ) {
      const path = pathFromInput(record.input);
      if (path) {
        failedEditsByPath[path] = (failedEditsByPath[path] ?? 0) + 1;
      }
    }
    if (
      (record.toolName === "edit_file" ||
        record.toolName === "replace_text" ||
        record.toolName === "replace_lines" ||
        record.toolName === "multi_replace_text") &&
      isFailedOutput(record.output)
    ) {
      const path = pathFromInput(record.input);
      if (path) {
        failedEditsByPath[path] = (failedEditsByPath[path] ?? 0) + 1;
        if ((failedEditsByPath[path] ?? 0) >= 2) phase = "recoverEdit";
      }
      if (
        record.toolName === "multi_replace_text" &&
        isRecord(record.output) &&
        record.output.code === "FIND_NOT_FOUND"
      ) {
        const hash = hashFromInput(record.input);
        if (path && hash) multiReplaceBlockedKeys.push(`${path}:${hash}`);
      }
    }
    if (record.toolName === "verify" && isRecord(record.output)) {
      const status =
        typeof record.output.status === "string" ? record.output.status : undefined;
      const failureScope =
        typeof record.output.failureScope === "string"
          ? record.output.failureScope
          : undefined;
      const recoverableEditedFailure =
        status === "failed" &&
        failureScope === "edited_file" &&
        !verifyRecoveryUsed;
      if (record.output.ok === true || status === "passed" || status === "skipped") {
        phase = "final";
        verifyFixPending = false;
      } else if (recoverableEditedFailure) {
        phase = "recoverEdit";
        verifyFixPending = true;
        lastVerifyFailureSummary = extractVerifyFailureSummary(record.output);
      } else {
        phase = "final";
        verifyFixPending = false;
        lastVerifyFailureSummary = extractVerifyFailureSummary(record.output);
      }
    }
  }

  const verifyCompleted = records.some(
    (record) =>
      record.toolName === "verify" &&
      isRecord(record.output) &&
      (record.output.ok === true ||
        record.output.status === "passed" ||
        record.output.status === "skipped" ||
        (record.output.status === "failed" &&
          record.output.failureScope !== "edited_file") ||
        record.output.status === "command_broken"),
  );

  return {
    phase,
    readCountsByPath,
    readCountsByPathRange,
    lastHashByPath,
    failedEditsByPath,
    multiReplaceBlockedKeys,
    recoveryReadUsedByPath,
    ...(verifyCompleted ? { verifyCompleted: true } : {}),
    ...(verifyFixPending
      ? {
          verifyFixPending: true,
          ...(lastVerifyFailureSummary
            ? { lastVerifyFailureSummary }
            : {}),
          editedPaths: [...editedPaths],
          ...(verifyRecoveryUsed ? { verifyRecoveryUsed: true } : {}),
        }
      : {}),
    ...(lastSuccessfulEdit ? { lastSuccessfulEdit } : {}),
  };
}

function blockedOutput(
  message: string,
  recommendedNext?: LoopGuardBlockedOutput["recommendedNext"],
  extra: Pick<
    LoopGuardBlockedOutput,
    "phase" | "failureCode" | "affectedPath"
  > = {},
): LoopGuardBlockedOutput {
  return {
    ok: false,
    code: "LOOP_GUARD_BLOCKED",
    message,
    ...(recommendedNext ? { recommendedNext } : {}),
    ...extra,
  };
}

function recommendedForTool(
  toolName: string,
): LoopGuardBlockedOutput["recommendedNext"] {
  if (toolName === "verify") return "final";
  if (toolName === "read_file") return "edit_text";
  if (toolName === "grep" || toolName === "glob") return "read_file";
  if (
    toolName === "edit_file" ||
    toolName === "edit_text" ||
    toolName === "replace_text" ||
    toolName === "replace_lines" ||
    toolName === "multi_replace_text"
  ) {
    return "edit_text";
  }
  return "verify";
}

function writeFileLooksLikeReplacement(
  input: unknown,
  pathWasRead: boolean,
): boolean {
  if (!isRecord(input)) return false;
  return typeof input.expectedHash === "string" || pathWasRead;
}

function incrementBounded(map: Map<string, number>, key: string): void {
  const next = (map.get(key) ?? 0) + 1;
  if (map.size >= MAP_CAP && !map.has(key)) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, next);
}

function pathFromInput(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  return typeof input.path === "string" && input.path.length > 0
    ? input.path
    : undefined;
}

function normalizeToolPath(value: string | undefined): string | undefined {
  return value?.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function hashFromInput(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  return typeof input.expectedHash === "string" && input.expectedHash.length > 0
    ? input.expectedHash
    : undefined;
}

function readFileRangeKeyFromOutput(
  output: Record<string, unknown>,
  path: string,
): string | undefined {
  const start = finiteNumber(output.startLine) ?? 1;
  const end = finiteNumber(output.endLine);
  if (end === undefined) return undefined;
  return `read_file:${path}:${start}-${end}`;
}

function readFileRangeKey(input: unknown, path: string): string | undefined {
  if (!isRecord(input)) return undefined;
  const start = finiteNumber(input.startLine) ?? 1;
  const end = finiteNumber(input.endLine) ?? start + 199;
  return `read_file:${path}:${start}-${end}`;
}

function isFullFileReadInput(input: unknown): boolean {
  if (!isRecord(input)) return true;
  return input.startLine === undefined && input.endLine === undefined;
}

function searchKeyForCall(toolName: string, input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  if (toolName === "grep") {
    const pattern = typeof input.pattern === "string" ? input.pattern : "";
    const path = typeof input.path === "string" ? input.path : ".";
    const glob = typeof input.glob === "string" ? input.glob : "";
    return `grep:${hashKey(`${pattern}|${path}|${glob}`)}`;
  }
  if (toolName === "glob") {
    const pattern = typeof input.pattern === "string" ? input.pattern : "";
    const path = typeof input.path === "string" ? input.path : ".";
    return `glob:${hashKey(`${pattern}|${path}`)}`;
  }
  return undefined;
}

function hashKey(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isFailedOutput(output: unknown): boolean {
  return isRecord(output) && output.ok === false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
