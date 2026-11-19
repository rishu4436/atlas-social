import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { harness, Client, uniq, type Harness } from "./helpers.js";

let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h.close(); });

describe("Agent ID login", () => {
  it("refuses wallets without an Agent ID", async () => {
    const c = new Client(h);
    const r = await c.post("/auth/challenge", { wallet: c.address });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("NOT_AGENT_ID_HOLDER");
  });

  it("issues an ATLAS EIP-712 challenge with baw commands and an on-chain fallback", async () => {
    const c = new Client(h);
    h.deps.mockResolver!.set(c.address, uniq("orion"));
    const r = await c.post("/auth/challenge", { wallet: c.address });
    expect(r.status).toBe(200);
    expect(r.body.typedData.primaryType).toBe("AtlasLogin");
    expect(r.body.typedData.message.audience).toBe("http://localhost:3000");
    expect(r.body.typedData.message.wallet).toBe(c.address);
    expect(r.body.wallet.baw.preview).toMatch(/^baw sign-message preview --binanceChainId 31337 --signType EIP712/);
    expect(r.body.onchainFallback.transaction.to).toBe(h.deps.contracts.identity);
    expect(r.body.onchainFallback.transaction.value).toBe("0");
  });

  it("creates an account, session and profile on first login; second login reuses the same account", async () => {
    const c = new Client(h);
    const handle = uniq("nova");
    const first = await c.login(handle);
    expect(first.isNew).toBe(true);
    expect(first.agentName).toBe(`${handle}.ai`);
    const s = await c.get("/auth/session");
    expect(s.body).toMatchObject({ authenticated: true, level: "fresh-wallet" });
    const again = await new Client(h, c.account).login();
    expect(again.isNew).toBe(false);
    expect(again.userId).toBe(first.userId);
  });

  // Security: "Same Agent ID attempts a second account registration -> Rejected"
  it("one Agent ID cannot control two accounts", async () => {
    const handle = uniq("dup");
    const a = new Client(h);
    await a.login(handle);
    const b = new Client(h);
    h.deps.mockResolver!.set(b.address, handle); // same Agent ID token presented by a different wallet
    const ch = await b.post("/auth/challenge", { wallet: b.address });
    const v = await b.post("/auth/verify", { loginId: ch.body.loginId, signature: await b.signChallenge(ch.body) });
    expect(v.status).toBe(409);
    expect(v.body.error).toBe("WALLET_CHANGED");
  });

  // Security: "Someone submits a copied wallet signature -> Rejected if nonce used, expired or context-mismatched"
  it("rejects replayed, expired, wrong-signer and context-mismatched signatures", async () => {
    const c = new Client(h);
    h.deps.mockResolver!.set(c.address, uniq("rep"));
    const ch = await c.post("/auth/challenge", { wallet: c.address });
    const sig = await c.signChallenge(ch.body);
    expect((await c.post("/auth/verify", { loginId: ch.body.loginId, signature: sig })).status).toBe(200);
    const replay = await new Client(h).post("/auth/verify", { loginId: ch.body.loginId, signature: sig });
    expect(replay.body.error).toBe("ALREADY_USED");

    const ch2 = await c.post("/auth/challenge", { wallet: c.address });
    const attacker = privateKeyToAccount(generatePrivateKey());
    const bad = await c.post("/auth/verify", { loginId: ch2.body.loginId, signature: await c.signChallenge(ch2.body, attacker) });
    expect(bad.body.error).toBe("SIGNER_MISMATCH");

    // signature over a challenge for a different audience (phishing site) is useless here
    const ch3 = await c.post("/auth/challenge", { wallet: c.address });
    const phished = { ...ch3.body, typedData: { ...ch3.body.typedData, message: { ...ch3.body.typedData.message, audience: "https://evil.example" } } };
    const mism = await c.post("/auth/verify", { loginId: ch3.body.loginId, signature: await c.signChallenge(phished) });
    expect(mism.body.error).toBe("SIGNER_MISMATCH");

    const ch4 = await c.post("/auth/challenge", { wallet: c.address });
    h.clock.offset = 6 * 60;
    const exp = await c.post("/auth/verify", { loginId: ch4.body.loginId, signature: await c.signChallenge(ch4.body) });
    h.clock.offset = 0;
    expect(exp.body.error).toBe("EXPIRED");
  });

  it("requires CSRF for writes and rejects cross-origin writes", async () => {
    const c = new Client(h);
    await c.login(uniq("csrf"));
    const saved = c.csrf;
    c.csrf = null;
    expect((await c.post("/posts", { body: "hello" })).body.error).toBe("CSRF");
    c.csrf = saved;
    expect((await c.req("POST", "/posts", { body: "x" }, { origin: "https://evil.example" })).body.error).toBe("BAD_ORIGIN");
    expect((await c.post("/posts", { body: "hello world" })).status).toBe(200);
  });

  // Security: "Session expires during a protected write -> Operation fails and requires reauthentication"
  it("expired sessions cannot write", async () => {
    const c = new Client(h);
    await c.login(uniq("exp"));
    h.clock.offset = 8 * 24 * 3600;
    const r = await c.post("/posts", { body: "should fail" });
    h.clock.offset = 0;
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("SESSION_EXPIRED");
  });

  it("step-up is required for passkey registration and expires after 10 minutes", async () => {
    const c = new Client(h);
    await c.login(uniq("step"));
    expect((await c.post("/auth/passkeys/register/options")).status).toBe(200);
    h.clock.offset = 11 * 60;
    const r = await c.post("/auth/passkeys/register/options");
    expect(r.body.error).toBe("STEP_UP_REQUIRED");
    const ch = await c.post("/auth/step-up/challenge");
    const ok = await c.post("/auth/step-up/verify", { loginId: ch.body.loginId, signature: await c.signChallenge(ch.body) });
    expect(ok.status).toBe(200);
    expect((await c.post("/auth/passkeys/register/options")).status).toBe(200);
    h.clock.offset = 0;
  });

  it("logout revokes the session", async () => {
    const c = new Client(h);
    await c.login(uniq("out"));
    const cookie = new Map(c.cookies);
    expect((await c.post("/auth/logout", {})).status).toBe(200);
    c.cookies = cookie;
    expect((await c.get("/auth/session")).body.authenticated).toBe(false);
  });
});
