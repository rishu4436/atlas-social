import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, http } from "viem";
import { foundry } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildApp } from "../src/app.js";
import { harness, Client, uniq, ORIGIN, type Harness } from "./helpers.js";

let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h.close(); });

async function holder(prefix = "onb") {
  const c = new Client(h);
  h.deps.mockResolver!.set(c.address, uniq(prefix));
  return c;
}

describe("onboarding: challenge lifecycle", () => {
  it("challenge carries timing (for the countdown) and per-shell baw commands", async () => {
    const c = await holder();
    const r = await c.post("/auth/challenge", { wallet: c.address });
    expect(r.status).toBe(200);
    expect(r.body.expiresAt - r.body.issuedAt).toBe(300);
    expect(r.body.ttlSeconds).toBe(300);
    expect(Math.abs(r.body.serverNow - Math.floor(Date.now() / 1000))).toBeLessThan(5);
    expect(r.body.chainId).toBe(31337);
    for (const k of ["posix", "powershell", "cmd"]) expect(r.body.wallet.baw.previewByShell[k]).toContain("baw sign-message preview --binanceChainId 31337 --signType EIP712");
    expect(r.body.wallet.baw.previewByShell.posix).toContain(r.body.loginId);
    expect(r.body.wallet.baw.checkAgentId).toBe("baw wallet agent-id --json");
  });

  it("status endpoint reports active → expired, and verify after expiry returns EXPIRED with a regenerate action", async () => {
    const c = await holder();
    const ch = await c.post("/auth/challenge", { wallet: c.address });
    expect((await c.get(`/auth/challenge/${ch.body.loginId}`)).body).toMatchObject({ state: "active", secondsLeft: expect.any(Number) });
    h.clock.offset = 301;
    try {
      expect((await c.get(`/auth/challenge/${ch.body.loginId}`)).body).toMatchObject({ state: "expired", secondsLeft: 0 });
      const v = await c.post("/auth/verify", { loginId: ch.body.loginId, signature: await c.signChallenge(ch.body) });
      expect(v.status).toBe(400);
      expect(v.body.error).toBe("EXPIRED");
      expect(v.body.details).toMatchObject({ action: "regenerate", fallback: false, title: "Challenge expired" });
      expect(v.body.message).toMatch(/5 minutes/);
    } finally { h.clock.offset = 0; }
  });

  it("regenerating with `replaces` invalidates the old commands (CHALLENGE_SUPERSEDED) and the new ones work", async () => {
    const c = await holder();
    const old = await c.post("/auth/challenge", { wallet: c.address });
    const fresh = await c.post("/auth/challenge", { wallet: c.address, replaces: old.body.loginId });
    expect(fresh.status).toBe(200);
    expect(fresh.body.loginId).not.toBe(old.body.loginId);
    expect((await c.get(`/auth/challenge/${old.body.loginId}`)).body).toMatchObject({ state: "superseded", supersededBy: fresh.body.loginId });
    const stale = await c.post("/auth/verify", { loginId: old.body.loginId, signature: await c.signChallenge(old.body) });
    expect(stale.body.error).toBe("CHALLENGE_SUPERSEDED");
    expect(stale.body.details.supersededBy).toBe(fresh.body.loginId);
    const ok = await c.post("/auth/verify", { loginId: fresh.body.loginId, signature: await c.signChallenge(fresh.body) });
    expect(ok.status).toBe(200);
    expect((await c.get(`/auth/challenge/${fresh.body.loginId}`)).body.state).toBe("used");
  });

  it("cannot supersede someone else's challenge", async () => {
    const victim = await holder("vic");
    const attacker = await holder("att");
    const vch = await victim.post("/auth/challenge", { wallet: victim.address });
    await attacker.post("/auth/challenge", { wallet: attacker.address, replaces: vch.body.loginId });
    expect((await victim.get(`/auth/challenge/${vch.body.loginId}`)).body.state).toBe("active");
    expect((await victim.post("/auth/verify", { loginId: vch.body.loginId, signature: await victim.signChallenge(vch.body) })).status).toBe(200);
  });

  it("unknown challenge → CHALLENGE_NOT_FOUND", async () => {
    const c = new Client(h);
    expect((await c.get(`/auth/challenge/${crypto.randomUUID()}`)).body.error).toBe("CHALLENGE_NOT_FOUND");
    expect((await c.post("/auth/verify", { loginId: crypto.randomUUID(), signature: "0x" + "ab".repeat(65) })).body.error).toBe("CHALLENGE_NOT_FOUND");
  });
});

describe("onboarding: structured verify errors", () => {
  it("no Agent ID → NOT_AGENT_ID_HOLDER with a claim action", async () => {
    const c = new Client(h);
    const r = await c.post("/auth/challenge", { wallet: c.address });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: "NOT_AGENT_ID_HOLDER", details: { action: "claim" } });
  });

  it("wrong signer → SIGNER_MISMATCH with recovered and expected address; the challenge is burned", async () => {
    const c = await holder();
    const ch = await c.post("/auth/challenge", { wallet: c.address });
    const other = privateKeyToAccount(generatePrivateKey());
    const v = await c.post("/auth/verify", { loginId: ch.body.loginId, signature: await c.signChallenge(ch.body, other) });
    expect(v.body.error).toBe("SIGNER_MISMATCH");
    expect(v.body.details).toMatchObject({ recoveredAddress: other.address, expectedAddress: c.address, challengeBurned: true, action: "regenerate" });
    // the right signature can't be used afterwards on the burned challenge
    expect((await c.post("/auth/verify", { loginId: ch.body.loginId, signature: await c.signChallenge(ch.body) })).body.error).toBe("ALREADY_USED");
  });

  it("truncated and malformed signatures get distinct codes", async () => {
    const c = await holder();
    const ch = await c.post("/auth/challenge", { wallet: c.address });
    const sig = await c.signChallenge(ch.body);
    expect((await c.post("/auth/verify", { loginId: ch.body.loginId, signature: sig.slice(0, 100) })).body).toMatchObject({ error: "SIGNATURE_TRUNCATED", details: { action: "fix-input" } });
    const ch2 = await c.post("/auth/challenge", { wallet: c.address });
    expect((await c.post("/auth/verify", { loginId: ch2.body.loginId, signature: "0x" + "zz".repeat(65) })).body.error).toBe("MALFORMED_SIGNATURE");
    const ch3 = await c.post("/auth/challenge", { wallet: c.address });
    expect((await c.post("/auth/verify", { loginId: ch3.body.loginId })).body.error).toBe("SIGNATURE_REQUIRED");
  });

  it("chain mismatch on a stored challenge → CHAIN_MISMATCH", async () => {
    const c = await holder();
    const ch = await c.post("/auth/challenge", { wallet: c.address });
    await h.deps.db.sys(`UPDATE login_challenges SET payload = jsonb_set(payload, '{chainId}', '1') WHERE id = $1`, [ch.body.loginId]);
    expect((await c.post("/auth/verify", { loginId: ch.body.loginId, signature: await c.signChallenge(ch.body) })).body.error).toBe("CHAIN_MISMATCH");
  });

  it("smart-contract wallet that rejects the signature → ERC1271_REJECTED routed to the on-chain fallback", async () => {
    const c = await holder("sc");
    const test = createTestClient({ chain: foundry, mode: "anvil", transport: http(h.deps.cfg.RPC_URL) });
    await test.setCode({ address: c.address, bytecode: "0x00" }); // contract code that never approves (STOP)
    try {
      const ch = await c.post("/auth/challenge", { wallet: c.address });
      const other = privateKeyToAccount(generatePrivateKey());
      const v = await c.post("/auth/verify", { loginId: ch.body.loginId, signature: await c.signChallenge(ch.body, other) });
      expect(v.body.error).toBe("ERC1271_REJECTED");
      expect(v.body.details).toMatchObject({ fallback: true, action: "fallback" });
    } finally { await test.setCode({ address: c.address, bytecode: "0x" }); }
  });

  it("on-chain proof without a transaction → PROOF_PENDING (never a fake success)", async () => {
    const c = await holder();
    const ch = await c.post("/auth/challenge", { wallet: c.address });
    const v = await c.post("/auth/verify", { loginId: ch.body.loginId, mode: "onchain" });
    expect(v.status).toBe(409);
    expect(v.body.error).toBe("PROOF_PENDING");
    expect((await c.get("/auth/session")).body.authenticated).toBe(false);
  });

  it("contracts pending → no fallback transaction offered and on-chain verify is refused with 503", async () => {
    const c = await holder();
    const saved = h.deps.contracts.atlasDeployed;
    (h.deps.contracts as any).atlasDeployed = false;
    try {
      const ch = await c.post("/auth/challenge", { wallet: c.address });
      expect(ch.body.contractsPending).toBe(true);
      expect(ch.body.onchainFallback).toBeNull();
      const v = await c.post("/auth/verify", { loginId: ch.body.loginId, mode: "onchain" });
      expect(v.status).toBe(503);
      expect(v.body.error).toBe("CONTRACTS_PENDING");
      expect((await c.get("/auth/session")).body.authenticated).toBe(false);
    } finally { (h.deps.contracts as any).atlasDeployed = saved; }
  });

  it("publishes the error catalog", async () => {
    const r = await new Client(h).get("/auth/errors");
    expect(r.status).toBe(200);
    for (const k of ["EXPIRED", "SIGNER_MISMATCH", "NOT_AGENT_ID_HOLDER", "SIGNATURE_TRUNCATED", "CHAIN_MISMATCH", "BAW_953004", "ERC1271_REJECTED", "RATE_LIMITED", "CHALLENGE_SUPERSEDED"]) {
      expect(r.body.codes[k]).toMatchObject({ title: expect.any(String), fix: expect.any(String), action: expect.any(String) });
    }
    expect(r.body.codes.BAW_953004.fallback).toBe(true);
  });
});

describe("onboarding: rate limit", () => {
  it("21st challenge in a minute → 429 RATE_LIMITED with retryAfterSeconds", async () => {
    const app = await buildApp(h.deps); // fresh limiter store
    try {
      const wallet = privateKeyToAccount(generatePrivateKey()).address;
      h.deps.mockResolver!.set(wallet, uniq("rl"));
      let last: any;
      for (let i = 0; i < 21; i++) last = await app.inject({ method: "POST", url: "/auth/challenge", payload: { wallet }, headers: { origin: ORIGIN } });
      expect(last.statusCode).toBe(429);
      const body = JSON.parse(last.body);
      expect(body.error).toBe("RATE_LIMITED");
      expect(body.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(body.details.action).toBe("wait");
    } finally { await app.close(); }
  });
});
