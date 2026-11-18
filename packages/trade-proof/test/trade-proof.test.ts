import { describe, it, expect } from "vitest";
import { encodeFunctionData, encodeEventTopics, encodeAbiParameters, type Hex } from "viem";
import { verifyTradeEvidence } from "../src/index.js";
import { PANCAKE_V2_ROUTER_ABI, ERC20_ABI } from "@atlas/wallet-integration";
import { PANCAKE_V2_ROUTER, USDT, WBNB } from "@atlas/shared-types";

const ALICE = "0x906bD5194CF49f667d712bBc9739a2223d834436" as const;
const MALLORY = "0x32774b32c9594055b0c8007ac14a15f62362a32a" as const;
const transferLog = (token: `0x${string}`, from: `0x${string}`, to: `0x${string}`, value: bigint) => ({
  address: token,
  topics: encodeEventTopics({ abi: ERC20_ABI, eventName: "Transfer", args: { from, to } }) as Hex[],
  data: encodeAbiParameters([{ type: "uint256" }], [value]),
});

function bnbToUsdt(sender = ALICE, recipient = ALICE) {
  const input = encodeFunctionData({ abi: PANCAKE_V2_ROUTER_ABI, functionName: "swapExactETHForTokens", args: [1n, [WBNB.address, USDT.address], recipient, 9999999999n] });
  return {
    tx: { hash: ("0x" + "aa".repeat(32)) as Hex, from: sender, to: PANCAKE_V2_ROUTER, input, value: 10n ** 18n, chainId: 56, blockNumber: 100n },
    receipt: { status: "success" as const, blockNumber: 100n, logs: [transferLog(USDT.address, "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE", recipient, 588n * 10n ** 18n)] },
  };
}

describe("verifyTradeEvidence", () => {
  it("verifies the claimant's own confirmed swap and hashes the evidence", () => {
    const { tx, receipt } = bnbToUsdt();
    const r = verifyTradeEvidence({ tx, receipt, claimant: ALICE, chainId: 56, headBlock: 120n });
    expect(r.status).toBe("VERIFIED");
    expect(r.evidence).toMatchObject({ tokenIn: "BNB", tokenOut: "USDT", amountIn: "1", amountOut: "588" });
    expect(r.evidenceHash).toMatch(/^0x/);
  });

  // Security table: "Attacker claims another person's trade hash -> proof rejected"
  it("rejects another person's trade hash", () => {
    const { tx, receipt } = bnbToUsdt();
    expect(verifyTradeEvidence({ tx, receipt, claimant: MALLORY, chainId: 56, headBlock: 120n })).toMatchObject({ status: "REJECTED", reasons: ["NOT_CLAIMANT_TX"] });
  });

  it("rejects swaps paying a third party, failed txs, unknown routers, wrong chain, non-swaps", () => {
    const third = bnbToUsdt(ALICE, MALLORY);
    expect(verifyTradeEvidence({ ...third, claimant: ALICE, chainId: 56, headBlock: 120n }).reasons).toEqual(["RECIPIENT_NOT_CLAIMANT"]);
    const { tx, receipt } = bnbToUsdt();
    expect(verifyTradeEvidence({ tx, receipt: { ...receipt, status: "reverted" }, claimant: ALICE, chainId: 56, headBlock: 120n }).reasons).toContain("TX_FAILED");
    expect(verifyTradeEvidence({ tx: { ...tx, to: MALLORY }, receipt, claimant: ALICE, chainId: 56, headBlock: 120n }).reasons).toContain("ROUTER_NOT_ALLOWED");
    expect(verifyTradeEvidence({ tx: { ...tx, chainId: 97 }, receipt, claimant: ALICE, chainId: 56, headBlock: 120n }).reasons).toEqual(["WRONG_CHAIN"]);
    expect(verifyTradeEvidence({ tx: { ...tx, input: "0xdeadbeef" }, receipt, claimant: ALICE, chainId: 56, headBlock: 120n }).reasons).toEqual(["NOT_A_SWAP"]);
    expect(verifyTradeEvidence({ tx, receipt: { ...receipt, logs: [] }, claimant: ALICE, chainId: 56, headBlock: 120n }).reasons).toEqual(["NO_OUTPUT_OBSERVED"]);
    expect(verifyTradeEvidence({ tx: null, receipt: null, claimant: ALICE, chainId: 56, headBlock: 1n }).reasons).toEqual(["TX_NOT_FOUND"]);
  });

  it("is PENDING until enough confirmations", () => {
    const { tx, receipt } = bnbToUsdt();
    expect(verifyTradeEvidence({ tx, receipt, claimant: ALICE, chainId: 56, headBlock: 105n }).status).toBe("PENDING");
  });
});
