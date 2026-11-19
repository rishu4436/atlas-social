import { encodeFunctionData, keccak256, toBytes, maxUint256, type Address, type Hex } from "viem";
import { AtlasPayAbi } from "@atlas/shared-types/abi";
import { ERC20_ABI, type UnsignedTx } from "./pancakeswap.js";

export const PAY_KINDS = ["direct", "tip", "request"] as const;
export type PayKind = (typeof PAY_KINDS)[number];
export const payKindIndex = (k: PayKind) => PAY_KINDS.indexOf(k);
export const PAY_CONTEXT_KINDS = ["profile", "post", "thesis", "dm", "request"] as const;
export type PayContextKind = (typeof PAY_CONTEXT_KINDS)[number];

/** Opaque on-chain reference: salted so nobody can link a payment to a conversation/post id by hashing guesses. */
export const payContextRef = (kind: PayContextKind, id: string, salt: Hex): Hex => keccak256(toBytes(`atlas-pay:v1:${kind}:${id}:${salt}`));
export const payMemoHash = (memo: string): Hex => (memo ? keccak256(toBytes(`atlas-pay-memo:v1:${memo}`)) : `0x${"0".repeat(64)}`);

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
