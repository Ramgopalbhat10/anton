"use client";

import { Gauge } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  AntonBudgetGateData,
  TokenBudgetMultiplierOption,
} from "@/src/lib/trace";

export function BudgetGateCard({
  gate,
  disabled,
  onExtend,
  compact = false,
}: {
  gate: AntonBudgetGateData;
  disabled?: boolean;
  onExtend: (runId: string, multiplier: TokenBudgetMultiplierOption) => void;
  compact?: boolean;
}) {
  if (gate.status === "resolved") {
    return (
      <p className="text-[11px] text-muted-foreground">
        Budget extended to {gate.selectedMultiplier ?? gate.currentMultiplier}x.
      </p>
    );
  }

  if (gate.status === "exhausted") {
    return (
      <p className="text-[11px] text-muted-foreground">
        Budget exhausted at {gate.currentMultiplier}x (
        {gate.tokensUsed.toLocaleString()} /{" "}
        {gate.currentMaxTotalTokens.toLocaleString()} tokens).
      </p>
    );
  }

  if (compact) {
    return (
      <div className="grid grid-cols-[0.875rem_minmax(0,1fr)] gap-2 py-0.5">
        <Gauge className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] text-foreground/85">
              Effective budget reached ·{" "}
              {(gate.effectiveTokensUsed ?? gate.tokensUsed).toLocaleString()} /{" "}
              {(gate.currentMaxEffectiveTokens ?? gate.currentMaxTotalTokens).toLocaleString()}{" "}
              ({gate.currentMultiplier}x)
            </span>
            {gate.options.map((multiplier) => (
              <Button
                key={multiplier}
                type="button"
                size="xs"
                variant="secondary"
                disabled={disabled}
                onClick={() => onExtend(gate.runId, multiplier)}
              >
                {multiplier}x
              </Button>
            ))}
          </div>
          {gate.lastFailedToolReason ? (
            <p className="mt-1 text-[11px] text-destructive/90">
              Latest tool failure: {gate.lastFailedToolReason}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section className="mt-2 overflow-hidden rounded-md border border-amber-400/30 bg-amber-400/5 ring-1 ring-amber-400/20">
      <div className="flex items-start gap-2 px-3 py-2">
        <Gauge className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground">
            Effective budget reached
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Effective{" "}
            {(gate.effectiveTokensUsed ?? gate.tokensUsed).toLocaleString()} /{" "}
            {(gate.currentMaxEffectiveTokens ?? gate.currentMaxTotalTokens).toLocaleString()}{" "}
            at {gate.currentMultiplier}x.
            {gate.cachedInputTokens !== undefined ? (
              <>
                {" "}
                Cached read {gate.cachedInputTokens.toLocaleString()}
                {gate.uncachedInputTokens !== undefined
                  ? ` · uncached ${gate.uncachedInputTokens.toLocaleString()}`
                  : ""}
                .
              </>
            ) : null}
            {" "}
            Raw total {gate.tokensUsed.toLocaleString()} /{" "}
            {gate.currentMaxTotalTokens.toLocaleString()}.
          </p>
          {gate.lastFailedToolReason ? (
            <p className="mt-1 text-[11px] leading-relaxed text-destructive/90">
              Latest tool failure: {gate.lastFailedToolReason}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {gate.options.map((multiplier) => (
              <Button
                key={multiplier}
                type="button"
                size="xs"
                variant="secondary"
                disabled={disabled}
                onClick={() => onExtend(gate.runId, multiplier)}
              >
                {multiplier}x
              </Button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
