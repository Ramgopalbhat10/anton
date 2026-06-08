import type { AgentRunProfile } from "./loop";

export type ProfilePromotionEvent = {
  fromProfile: "localized-edit" | "single-file-edit";
  toProfile: "general-chat";
  reason: string;
};

export type PromotionTriggerInput = {
  distinctPathsRead: number;
  partialReadPaths: number;
  failedEditPaths: number;
  searchStepsBeforeEdit: number;
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

  if (reasons.length === 0) return undefined;

  return {
    fromProfile: "localized-edit",
    toProfile: "general-chat",
    reason: reasons[0],
  };
}

export function singleFileEditHandoff(reason: string): ProfilePromotionEvent {
  return {
    fromProfile: "single-file-edit",
    toProfile: "general-chat",
    reason,
  };
}
