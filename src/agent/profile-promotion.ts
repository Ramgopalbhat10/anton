import type { AgentRunProfile } from "./loop";

export type ProfilePromotionEvent = {
  fromProfile: AgentRunProfile;
  toProfile: AgentRunProfile;
  reason: string;
};

export type PromotionTriggerInput = {
  distinctPathsRead: number;
  partialReadPaths: number;
  failedEditPaths: number;
  searchStepsBeforeEdit: number;
  effectiveTokensUsed: number;
  maxEffectiveTokens: number;
  hadSuccessfulEdit: boolean;
};

export function evaluateFastEditPromotion(
  profile: AgentRunProfile,
  alreadyPromoted: boolean,
  input: PromotionTriggerInput,
): ProfilePromotionEvent | undefined {
  if (profile !== "localized-edit" || alreadyPromoted) return undefined;
  if (input.hadSuccessfulEdit) return undefined;

  const reasons: string[] = [];

  if (input.partialReadPaths > 1) {
    reasons.push(
      "Multiple target files required partial reads; continuing with full Agent tools avoids repeated range reads.",
    );
  }
  if (input.distinctPathsRead > 3) {
    reasons.push("Several files appear relevant to this task.");
  }
  if (input.failedEditPaths > 0) {
    reasons.push("An edit attempt failed and needs broader recovery tools.");
  }
  if (input.searchStepsBeforeEdit >= 3) {
    reasons.push("Multiple searches ran before a successful edit.");
  }
  if (
    input.maxEffectiveTokens > 0 &&
    input.effectiveTokensUsed >= Math.floor(input.maxEffectiveTokens * 0.75)
  ) {
    reasons.push(
      "Half of the fast-edit effective budget was used without a successful edit.",
    );
  }

  if (reasons.length === 0) return undefined;

  return {
    fromProfile: "localized-edit",
    toProfile: "general-chat",
    reason: reasons[0],
  };
}
