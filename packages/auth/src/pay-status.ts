/**
 * ATLAS Pay transaction lifecycle (audit 2026-11-20 F3). Browser-safe, no dependencies.
 *
 *   prepared  → unsigned steps built by ATLAS; nothing was signed or sent
 *   broadcast → a tx hash exists and matches the reviewed step; no receipt yet (it can still be dropped or replaced)
 *   mined     → a successful receipt exists; AtlasPay's PaymentSent event is not indexed yet
 *   confirmed → PaymentSent indexed from the chain (provisional: a reorg can still remove it)
 *   finalized → PaymentSent at final depth (the indexer's confirmation threshold): the ONLY stage that means "paid"
 *
 * Terminal failures: reverted (mined, failed: no payment), replaced (the sender's nonce was used by another tx),
 * dropped (unknown to the chain after the grace period). A USDT `approve` step only ever reaches
 * approval_mined: an approval is never a payment.
 *
 * `{ verified: true, mined: false }` from the handoff means "the broadcast tx matches what you reviewed", nothing more.
 */
export const PAY_STAGES = ["prepared", "broadcast", "mined", "confirmed", "finalized"] as const;
export type PayStage = (typeof PAY_STAGES)[number] | "reverted" | "replaced" | "dropped" | "approval_mined";
/** approve: USDT allowance (never a payment) · pay: AtlasPay call (PaymentSent event) · transfer: plain baw fallback send (no event, final by depth) */
export type PayStepKind = "approve" | "pay" | "transfer";

export const PAY_STAGE_LABEL: Record<PayStage, string> = {
  prepared: "Prepared · not sent",
  broadcast: "Broadcast · not mined yet",
  mined: "Mined · waiting for the PaymentSent event",
  confirmed: "Confirmed on-chain · finalizing",
  finalized: "Finalized · paid",
  reverted: "Reverted · no payment was made",
  replaced: "Replaced · this transaction never executed",
  dropped: "Dropped · not found on chain",
  approval_mined: "Approval mined · payment step still required",
};

/** The only check UIs may use before showing a payment as paid. */
export const isPaid = (s: PayStage | null | undefined) => s === "finalized";
export const isFailedStage = (s: PayStage | null | undefined) => s === "reverted" || s === "replaced" || s === "dropped";
/** Index in the 5-step happy path (failures map to -1). */
export const stageIndex = (s: PayStage | null | undefined) => (s === "approval_mined" ? 2 : PAY_STAGES.indexOf(s as any));

export interface PayStageInput {
  stepKind: PayStepKind;
  /** an indexed PaymentSent row for this tx: provisional | final */
  event?: "provisional" | "final" | null;
  receipt?: "success" | "reverted" | null;
  /** the node knows the tx (mempool or chain) */
  known?: boolean;
  /** the sender's latest nonce is above this tx's nonce */
  nonceConsumed?: boolean;
  /** seconds since the hash was first reported */
  ageSeconds?: number;
  /** plain transfers only: the receipt is at or below the indexer's finality depth */
  deepEnough?: boolean;
}

/** Pure stage derivation (ordered: chain events beat receipts beat mempool). */
export function deriveStage(i: PayStageInput, dropAfterSeconds = 600): PayStage {
  if (i.stepKind === "pay" && i.event === "final") return "finalized";
  if (i.stepKind === "pay" && i.event === "provisional") return "confirmed";
  if (i.receipt === "reverted") return "reverted";
  if (i.receipt === "success") return i.stepKind === "approve" ? "approval_mined" : i.stepKind === "transfer" && i.deepEnough ? "finalized" : "mined";
  if (i.nonceConsumed) return "replaced";
  if (i.known) return "broadcast";
  return (i.ageSeconds ?? 0) > dropAfterSeconds ? "dropped" : "broadcast";
}

export function stageView(stage: PayStage, stepKind: PayStepKind) {
  return { stage, stageLabel: PAY_STAGE_LABEL[stage], stepKind, paid: isPaid(stage), final: stage === "finalized" || isFailedStage(stage) };
}
