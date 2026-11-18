import { describe, it, expect } from "vitest";
import { decodeFunctionData, maxUint256 } from "viem";
import { prepareSwap, assertSafeSteps, PANCAKE_V2_ROUTER_ABI, ERC20_ABI, SwapError, atlasCalls } from "../src/index.js";
import { PANCAKE_V2_ROUTER, tokenBySymbol } from "@atlas/shared-types";

const FROM = "0x906bD5194CF49f667d712bBc9739a2223d834436" as const;
// constant-product pool: 1000 BNB / 588,000 USDT
const pool = (rIn: bigint, rOut: bigint) => (a: bigint) => (a * 9975n * rOut) / (rIn * 10000n + a * 9975n);
const reader = (impactPool = pool(1000n * 10n ** 18n, 588000n * 10n ** 18n)) => ({
  getAmountsOut: async (a: bigint, path: `0x${string}`[]) => (path.length === 2 ? [a, impactPool(a)] : [a, a, impactPool(a)]),
  allowance: async () => 0n,
});

describe("prepareSwap", () => {
  it("BNB -> USDT: single swap step, value = amount, recipient is the user, min-out applies slippage", async () => {
    const p = await prepareSwap({ from: FROM, tokenIn: "BNB", tokenOut: "USDT", amountIn: "1", slippageBps: 50, reader: reader(), now: 1000 });
    expect(p.steps).toHaveLength(1);
    const s = p.steps[0]!;
    expect(s.to).toBe(PANCAKE_V2_ROUTER);
    expect(s.value).toBe((10n ** 18n).toString());
    const d = decodeFunctionData({ abi: PANCAKE_V2_ROUTER_ABI, data: s.data });
    expect(d.functionName).toBe("swapExactETHForTokens");
    expect(d.args![2]).toBe(FROM);
    expect(Number(p.minimumOut)).toBeCloseTo(Number(p.expectedOut) * 0.995, 6);
    expect(p.route).toEqual(["BNB", "USDT"]);
    expect(p.riskDisclosure).toMatch(/risky/);
    expect(p.deadline).toBe(2200);
  });

  it("USDT -> BNB adds an EXACT approval (never unlimited) before the swap", async () => {
    const p = await prepareSwap({ from: FROM, tokenIn: "USDT", tokenOut: "BNB", amountIn: "100", reader: reader(pool(10n ** 30n, 10n ** 27n)) });
    expect(p.steps).toHaveLength(2);
    const ap = decodeFunctionData({ abi: ERC20_ABI, data: p.steps[0]!.data });
    expect(ap.functionName).toBe("approve");
    expect(ap.args![1]).toBe(100n * 10n ** 18n);
    expect(ap.args![1]).not.toBe(maxUint256);
    expect(decodeFunctionData({ abi: PANCAKE_V2_ROUTER_ABI, data: p.steps[1]!.data }).functionName).toBe("swapExactTokensForETH");
    assertSafeSteps(p.steps, FROM);
  });

  it("skips approval when allowance suffices and routes token->token via WBNB", async () => {
    const r = { ...reader(), allowance: async () => 10n ** 30n };
    const p = await prepareSwap({ from: FROM, tokenIn: "CAKE", tokenOut: "USDT", amountIn: "5", reader: r });
    expect(p.steps).toHaveLength(1);
    expect(p.route).toEqual(["CAKE", "WBNB", "USDT"]);
  });

  it("blocks large price impact and rejects bad inputs", async () => {
    const p = await prepareSwap({ from: FROM, tokenIn: "BNB", tokenOut: "USDT", amountIn: "200", reader: reader() });
    expect(p.blocked).toBe(true);
    expect(p.steps).toHaveLength(0);
    await expect(prepareSwap({ from: FROM, tokenIn: "BNB", tokenOut: "SHIB", amountIn: "1", reader: reader() })).rejects.toThrow(SwapError);
    await expect(prepareSwap({ from: FROM, tokenIn: "BNB", tokenOut: "USDT", amountIn: "1", slippageBps: 900, reader: reader() })).rejects.toThrow(/slippage/);
    await expect(prepareSwap({ from: FROM, tokenIn: "BNB", tokenOut: "WBNB", amountIn: "1", reader: reader() })).rejects.toThrow(/differ/);
    await expect(prepareSwap({ from: FROM, tokenIn: "BNB", tokenOut: "USDT", amountIn: "abc", reader: reader() })).rejects.toThrow(/amount/);
  });

  it("assertSafeSteps rejects unlimited approvals", () => {
    const usdt = tokenBySymbol("USDT")!;
    expect(() => assertSafeSteps([{ chainId: 56, from: FROM, to: usdt.address, data: ("0x095ea7b3" + "0".repeat(24) + PANCAKE_V2_ROUTER.slice(2).toLowerCase() + "f".repeat(64)) as `0x${string}`, value: "0", description: "" }], FROM)).toThrow(/unlimited/);
  });
});

describe("atlas calls", () => {
  it("encodes registerIdentity with no value", () => {
    const t = atlasCalls.registerIdentity(56, FROM, FROM, ("0x" + "11".repeat(32)) as `0x${string}`);
    expect(t.value).toBe("0");
    expect(t.data.length).toBe(2 + 8 + 64);
  });
});
