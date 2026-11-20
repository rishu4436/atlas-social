"use client";
import * as React from "react";
import { Check, X } from "lucide-react";
import { cx } from "@atlas/design-system";
import { PAY_STAGES, PAY_STAGE_LABEL, isFailedStage, stageIndex, type PayStage } from "@atlas/auth/pay-status";

const SHORT: Record<(typeof PAY_STAGES)[number], string> = { prepared: "Prepared", broadcast: "Broadcast", mined: "Mined", confirmed: "Confirmed", finalized: "Finalized" };

/**
 * Audit 2026-11-20 F3: the five payment stages, kept visibly distinct. Only "Finalized" is paid; a USDT approval
 * (approval_mined) is shown as an approval, never as a payment.
 */
export function PayStageStepper({ stage, className }: { stage: PayStage; className?: string }) {
  const failed = isFailedStage(stage);
  const at = stageIndex(stage);
  return (
    <div className={cx("space-y-2", className)} data-testid="pay-stage" data-stage={stage} data-paid={stage === "finalized" ? "true" : "false"}>
      <ol className="flex items-center gap-1" aria-label="Payment stages">
        {PAY_STAGES.map((s, i) => {
          const done = !failed && i <= at;
          return (
            <li key={s} className="flex flex-1 flex-col items-center gap-1" aria-current={i === at ? "step" : undefined}>
              <span className={cx("grid h-5 w-5 place-items-center rounded-full border text-[10px]",
                done ? (s === "finalized" ? "border-emerald-up bg-emerald-up/20 text-emerald-up" : "border-signal bg-signal/15 text-signal") : "border-line text-ink-faint")}>
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className={cx("text-[10px]", done ? "text-ink" : "text-ink-faint")}>{SHORT[s]}</span>
            </li>
          );
        })}
      </ol>
      <p className={cx("flex items-center justify-center gap-1 text-xs", failed ? "text-coral-down" : stage === "finalized" ? "text-emerald-up" : "text-amber-warn")} data-testid="pay-stage-label">
        {failed && <X className="h-3.5 w-3.5" />}{PAY_STAGE_LABEL[stage]}
      </p>
    </div>
  );
}
