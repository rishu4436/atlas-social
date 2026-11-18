import { describe, it, expect } from "vitest";
import { OnchainAgentIdResolver, MockAgentIdResolver, agentTokenId, CachedAgentIdResolver } from "../src/index.js";

const W = "0x906bD5194CF49f667d712bBc9739a2223d834436" as const;
function fakeClient(state: { bal: bigint; handle: string; owner: string | Error }) {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceOf") return state.bal;
      if (functionName === "handleOf") return state.handle;
      if (state.owner instanceof Error) throw state.owner;
      return state.owner;
    },
  } as never;
}

describe("OnchainAgentIdResolver", () => {
  it("tokenId = keccak256(handle) (verified against live registry: panqpunq)", () => {
    expect(agentTokenId("panqpunq")).toBe(0x5033b8d11b1a021df74384f3a81ed8ed5623561e28216d56b2f0780eb62b792bn);
  });
  it("accepts a consistent holder", async () => {
    const r = await new OnchainAgentIdResolver(fakeClient({ bal: 1n, handle: "panqpunq", owner: W })).resolve(W);
    expect(r).toMatchObject({ eligible: true, handle: "panqpunq", agentName: "panqpunq.ai" });
  });
  it("rejects balance 0, empty handle, owner mismatch and missing token", async () => {
    for (const s of [
      { bal: 0n, handle: "x", owner: W },
      { bal: 1n, handle: "", owner: W },
      { bal: 1n, handle: "x", owner: "0x0000000000000000000000000000000000000001" },
      { bal: 1n, handle: "x", owner: new Error("ERC721NonexistentToken") },
    ]) expect((await new OnchainAgentIdResolver(fakeClient(s)).resolve(W)).eligible).toBe(false);
  });
});

describe("Mock + cache", () => {
  it("mock resolves configured wallets only", async () => {
    const m = new MockAgentIdResolver({ [W]: "orion" });
    expect((await m.resolve(W)).agentName).toBe("orion.ai");
    expect((await m.resolve("0x0000000000000000000000000000000000000002")).eligible).toBe(false);
  });
  it("cache honours fresh", async () => {
    const m = new MockAgentIdResolver({ [W]: "orion" });
    const c = new CachedAgentIdResolver(m);
    expect((await c.resolve(W)).eligible).toBe(true);
    m.set(W, null);
    expect((await c.resolve(W)).eligible).toBe(true);
    expect((await c.resolve(W, { fresh: true })).eligible).toBe(false);
  });
});
