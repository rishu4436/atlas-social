import { concat, encodeFunctionData, keccak256, toBytes, toHex, maxUint256, type Address, type Hex } from "viem";
import { AtlasPayAbi } from "@atlas/shared-types/abi";
import { ERC20_ABI, type UnsignedTx } from "./pancakeswap.js";

export const PAY_KINDS = ["direct", "tip", "request"] as const;
export type PayKind = (typeof PAY_KINDS)[number];
export const payKindIndex = (k: PayKind) => PAY_KINDS.indexOf(k);
export const PAY_CONTEXT_KINDS = ["profile", "post", "thesis", "dm", "request"] as const;
export type PayContextKind = (typeof PAY_CONTEXT_KINDS)[number];

/** Opaque on-chain reference: salted so nobody can link a payment to a conversation/post id by hashing guesses. */
export const payContextRef = (kind: PayContextKind, id: string, salt: Hex): Hex => keccak256(toBytes(`atlas-pay:v1:${kind}:${id}:${salt}`));
/**
 * LEGACY (v1, receipts prepared before 2026-11-20): deterministic keccak256 of the memo text. A public observer can
 * test guessed memos against the on-chain memoHash. Kept only to verify old receipts.
 */
export const payMemoHash = (memo: string): Hex => (memo ? keccak256(toBytes(`atlas-pay-memo:v1:${memo}`)) : `0x${"0".repeat(64)}`);
export const MEMO_SCHEMES = { v1: "keccak-utf8-v1", v2: "salted-keccak-v2" } as const;
export type MemoScheme = (typeof MEMO_SCHEMES)[keyof typeof MEMO_SCHEMES];
/** A fresh 32-byte salt per payment. Stored off-chain and shown only to the two parties. */
export const randomMemoSalt = (): Hex => toHex(crypto.getRandomValues(new Uint8Array(32)));
/**
 * v2 hiding commitment: keccak256(salt ‖ "atlas-pay-memo:v2:" ‖ memo). Without the salt the memo cannot be brute-forced
 * from the on-chain memoHash. Same bytes32 slot as v1, so the deployed AtlasPay event format is unchanged. An empty memo
 * stays bytes32(0) (nothing to hide).
 */
export const payMemoCommitment = (memo: string, salt: Hex): Hex => {
  if (!memo) return `0x${"0".repeat(64)}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) throw new PayError("memo salt must be 32 bytes");
  return keccak256(concat([salt, toHex(`atlas-pay-memo:v2:${memo}`)]));
};
export function verifyMemo(memo: string, memoHash: Hex, salt?: Hex | null): { ok: boolean; scheme: MemoScheme } {
  if (salt) return { ok: payMemoCommitment(memo, salt).toLowerCase() === memoHash.toLowerCase(), scheme: MEMO_SCHEMES.v2 };
  return { ok: payMemoHash(memo).toLowerCase() === memoHash.toLowerCase(), scheme: MEMO_SCHEMES.v1 };
}

export class PayError extends Error {}

export interface PayPlanArgs {
  chainId: number;
  from: Address;
  pay: Address;
  asset: "BNB" | "USDT";
  stable: Address;
  amountWei: bigint;
  recipientTokenId: bigint;
  expectedRecipient: Address;
  kind: PayKind;
  contextRef: Hex;
  memoHash: Hex;
  /** current allowance of `from` to `pay` on the stable token (USDT only) */
  allowance?: bigint;
}

/** Unsigned steps for the sender's own wallet: [approve exact amount (if needed)], pay. */
export function planPayment(a: PayPlanArgs): UnsignedTx[] {
  if (a.amountWei <= 0n) throw new PayError("amount must be > 0");
  if (a.from.toLowerCase() === a.expectedRecipient.toLowerCase()) throw new PayError("cannot pay yourself");
  const p = { recipientTokenId: a.recipientTokenId, expectedRecipient: a.expectedRecipient, kind: payKindIndex(a.kind), contextRef: a.contextRef, memoHash: a.memoHash };
  if (a.asset === "BNB") {
    return [{ chainId: a.chainId, from: a.from, to: a.pay, value: a.amountWei.toString(), data: encodeFunctionData({ abi: AtlasPayAbi, functionName: "payNative", args: [p] }), description: "Pay with BNB via AtlasPay (forwarded to the recipient in the same transaction)" }];
  }
  const steps: UnsignedTx[] = [];
  if ((a.allowance ?? 0n) < a.amountWei) {
    steps.push({ chainId: a.chainId, from: a.from, to: a.stable, value: "0", data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [a.pay, a.amountWei] }), description: "Approve exactly this USDT amount for AtlasPay (not unlimited)" });
  }
  steps.push({ chainId: a.chainId, from: a.from, to: a.pay, value: "0", data: encodeFunctionData({ abi: AtlasPayAbi, functionName: "payToken", args: [a.stable, a.amountWei, p] }), description: "Pay with USDT via AtlasPay (moves sender → recipient directly; AtlasPay keeps nothing)" });
  return steps;
}

/** Guard: only exact approvals to AtlasPay, every step from the sender, value only on payNative. */
export function assertSafePaySteps(steps: UnsignedTx[], a: Pick<PayPlanArgs, "from" | "pay" | "stable" | "amountWei" | "asset">) {
  for (const s of steps) {
    if (s.from.toLowerCase() !== a.from.toLowerCase()) throw new PayError("step from mismatch");
    if (s.data.startsWith("0x095ea7b3")) {
      if (s.to.toLowerCase() !== a.stable.toLowerCase()) throw new PayError("approve on unexpected token");
      const spender = `0x${s.data.slice(34, 74)}`;
      const amount = BigInt(`0x${s.data.slice(74, 138)}`);
      if (spender.toLowerCase() !== a.pay.toLowerCase()) throw new PayError("approve to unexpected spender");
      if (amount === maxUint256 || amount !== a.amountWei) throw new PayError("approval must equal the payment amount");
    } else if (s.to.toLowerCase() !== a.pay.toLowerCase()) throw new PayError("unexpected call target");
    if (BigInt(s.value) !== 0n && !(a.asset === "BNB" && BigInt(s.value) === a.amountWei)) throw new PayError("unexpected value");
  }
}
