import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

export const DAY = 24 * 60 * 60;
export const b32 = (s: string) => ethers.encodeBytes32String(s);
export const px = (n: number) => BigInt(Math.round(n * 1e8));

export async function deployAll() {
  const [deployer, alice, bob, carol, evaluator, outsider] = await ethers.getSigners();
  const agent = await ethers.deployContract("MockAgentID");
  await agent.registerFor(alice.address, "alice");
  await agent.registerFor(bob.address, "bob");
  await agent.registerFor(carol.address, "carol");
  const identity = await ethers.deployContract("AtlasIdentity", [await agent.getAddress()]);
  const registry = await ethers.deployContract("ThesisRegistry", [await agent.getAddress()]);
  const attestor = await ethers.deployContract("OutcomeAttestor", [
    await agent.getAddress(),
    await registry.getAddress(),
    2 * DAY,
    deployer.address,
  ]);
  await attestor.setEvaluator(evaluator.address, true);
  return { deployer, alice, bob, carol, evaluator, outsider, agent, identity, registry, attestor };
}

export async function longTerms(overrides: Partial<Record<string, unknown>> = {}) {
  const now = await time.latest();
  return {
    market: b32("BINANCE:BNBUSDT"),
    priceSource: b32("BINANCE_SPOT_KLINE_1H"),
    direction: 1,
    entryPrice: px(600),
    targetPrice: px(660),
    invalidationPrice: px(570),
    startTime: now + 3600,
    endTime: now + 7 * DAY,
    confidenceBps: 6500,
    methodology: 1,
    contentHash: ethers.keccak256(ethers.toUtf8Bytes("BNB breakout thesis v1")),
    ...overrides,
  };
}
