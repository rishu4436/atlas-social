import { describe, it, expect } from "vitest";
import { decodeFunctionData, maxUint256, encodeFunctionData, type Address } from "viem";
import { AtlasPayAbi } from "@atlas/shared-types/abi";
import { planPayment, assertSafePaySteps, payContextRef, payMemoHash, ERC20_ABI, PayError } from "../src/index.js";

const from = "0x1111111111111111111111111111111111111111" as Address;
const to = "0x2222222222222222222222222222222222222222" as Address;
const pay = "0x3333333333333333333333333333333333333333" as Address;
const stable = "0x55d398326f99059fF775485246999027B3197955" as Address;
const base = { chainId: 56, from, pay, stable, recipientTokenId: 42n, expectedRecipient: to, kind: "tip" as const, contextRef: payContextRef("post", "p1", "0x01"), memoHash: payMemoHash("") };

describe("planPayment", () => {
  it("BNB: one payNative call carrying exactly the value", () => {
    const s = planPayment({ ...base, asset: "BNB", amountWei: 10n ** 17n });
    expect(s).toHaveLength(1);
    expect(s[0]!.value).toBe("100000000000000000");
    const d = decodeFunctionData({ abi: AtlasPayAbi, data: s[0]!.data });
    expect(d.functionName).toBe("payNative");
    expect((d.args![0] as any).expectedRecipient).toBe(to);
    expect((d.args![0] as any).kind).toBe(1);
    assertSafePaySteps(s, { ...base, asset: "BNB", amountWei: 10n ** 17n });
  });
  it("USDT: exact approve then payToken; skips approve when allowance suffices", () => {
    const s = planPayment({ ...base, asset: "USDT", amountWei: 5n * 10n ** 18n, allowance: 0n });
    expect(s.map((x) => x.to)).toEqual([stable, pay]);
    const ap = decodeFunctionData({ abi: ERC20_ABI, data: s[0]!.data });
    expect(ap.args).toEqual([pay, 5n * 10n ** 18n]);
    expect(planPayment({ ...base, asset: "USDT", amountWei: 5n, allowance: 5n })).toHaveLength(1);
    assertSafePaySteps(s, { ...base, asset: "USDT", amountWei: 5n * 10n ** 18n });
  });
  it("refuses self-payment and zero", () => {
    expect(() => planPayment({ ...base, asset: "BNB", amountWei: 1n, expectedRecipient: from })).toThrow(PayError);
    expect(() => planPayment({ ...base, asset: "BNB", amountWei: 0n })).toThrow(PayError);
  });
  it("guard rejects unlimited / wrong-spender approvals and stray value", () => {
    const unlimited = { chainId: 56, from, to: stable, value: "0", description: "", data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [pay, maxUint256] }) };
    expect(() => assertSafePaySteps([unlimited], { ...base, asset: "USDT", amountWei: 1n })).toThrow(/approval/);
    const wrong = { ...unlimited, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [to, 1n] }) };
    expect(() => assertSafePaySteps([wrong], { ...base, asset: "USDT", amountWei: 1n })).toThrow(/spender/);
    const s = planPayment({ ...base, asset: "USDT", amountWei: 1n, allowance: 1n });
    expect(() => assertSafePaySteps([{ ...s[0]!, value: "1" }], { ...base, asset: "USDT", amountWei: 1n })).toThrow(/value/);
  });
  it("context refs are salted and opaque", () => {
    expect(payContextRef("dm", "c1", "0x01")).not.toBe(payContextRef("dm", "c1", "0x02"));
    expect(payMemoHash("")).toBe(`0x${"0".repeat(64)}`);
  });
});

describe("memo commitments (audit F4)", () => {
  it("v2 is salted: same memo, different salts → different on-chain hashes; verifiable only with the salt", async () => {
    const { payMemoCommitment, randomMemoSalt, verifyMemo, payMemoHash } = await import("../src/payCalls.js");
    const a = randomMemoSalt(), b = randomMemoSalt();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    const ha = payMemoCommitment("rent", a), hb = payMemoCommitment("rent", b);
    expect(ha).not.toBe(hb);
    expect(ha).not.toBe(payMemoHash("rent"));
    expect(verifyMemo("rent", ha, a)).toEqual({ ok: true, scheme: "salted-keccak-v2" });
    expect(verifyMemo("rent", ha, b).ok).toBe(false);
    expect(verifyMemo("rent", ha).ok).toBe(false); // guessing without the salt fails
    // legacy receipts keep verifying with the deterministic v1 scheme
    expect(verifyMemo("rent", payMemoHash("rent"))).toEqual({ ok: true, scheme: "keccak-utf8-v1" });
    expect(payMemoCommitment("", a)).toBe(`0x${"0".repeat(64)}`);
  });
});
