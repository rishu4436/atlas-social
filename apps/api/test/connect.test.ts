/**
 * ATLAS Connect ("Continue with Binance Agentic Wallet"): browser-bound intents, handoff proof, one-time redemption.
 * The "handoff" is a separate client with no cookies — exactly what an agent, terminal or companion is.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, createWalletClient, http, parseEther, type Hex } from "viem";
import { foundry } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CONNECT_CODE_RE } from "@atlas/auth";
import { harness, Client, uniq, TEST_APP_DB, type Harness } from "./helpers.js";
import pg from "pg";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h?.close(); });

/** The handoff side: no cookies, no Origin (a CLI / agent), only the public code. */
const handoff = async (path: string, body: unknown) => {
  const res = await h.app.inject({ method: "POST", url: `/auth/connect/handoff/${path}`, payload: body as any });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};

async function start(browser = new Client(h), purpose: "login" | "step-up" = "login") {
  const r = await browser.post("/auth/connect/intents", { purpose });
  expect(r.status).toBe(200);
  return { browser, intent: r.body };
}

/** Runs the handoff for `account` up to an approved proof (what baw + the companion do). */
async function prove(code: string, signer: Client) {
  const ch = await handoff("challenge", { code, wallet: signer.address });
  expect(ch.status).toBe(200);
  const sig = await signer.signChallenge(ch.body);
  return { ch, done: await handoff("complete", { code, loginId: ch.body.loginId, signature: sig }) };
}

function holder(prefix = "cx") {
  const c = new Client(h);
  const handle = uniq(prefix);
  h.deps.mockResolver!.set(c.address, handle);
  return { c, handle, agentName: `${handle}.ai` };
}

describe("ATLAS Connect: happy paths", () => {
  it("new user: browser intent → handoff proof → browser redeems once → profile setup", async () => {
    const { browser, intent } = await start();
    expect(intent.code).toMatch(CONNECT_CODE_RE);
    expect(intent.expiresAt - intent.serverNow).toBe(600);
    expect(intent.handoff.agentPrompt).toContain(intent.code);
    expect(intent.handoff.terminal).toContain(`login ${intent.code}`);
    // the browser verifier never appears in the response, only in an httpOnly SameSite=Strict cookie
    expect(JSON.stringify(intent)).not.toContain(browser.cookies.get("atlas_connect_login")!.split(".")[1]);

    const open = await handoff("open", { code: intent.code });
    expect(open.body).toMatchObject({ purpose: "login", status: "pending" });
    expect(open.body.knownIssue.issue).toBe("https://github.com/binance/binance-skills-hub/issues/400");

    const w = holder();
    const { ch, done } = await prove(intent.code, w.c);
    expect(ch.body.typedData.primaryType).toBe("AtlasLogin");
    expect(ch.body.baw.preview).toMatch(/^baw sign-message preview --binanceChainId 31337 --signType EIP712/);
    expect(JSON.parse(ch.body.signRequest).method).toBe("eth_signTypedData_v4");
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ ok: true, status: "approved", agentName: w.agentName });

    const poll = await browser.get(`/auth/connect/intents/${intent.intentId}`);
    expect(poll.body).toMatchObject({ status: "approved", agentName: w.agentName, wallet: w.c.address.toLowerCase() });
    expect((await browser.get("/auth/session")).body.authenticated).toBe(false); // nothing happens until the browser redeems

    const red = await browser.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName });
    expect(red.status).toBe(200);
    expect(red.body).toMatchObject({ purpose: "login", isNew: true, agentName: w.agentName, next: "/welcome/profile" });
    const s = (await browser.get("/auth/session")).body;
    expect(s).toMatchObject({ authenticated: true, level: "fresh-wallet" });
    expect(s.states.agentId).toMatchObject({ verified: true, agentName: w.agentName, wallet: w.c.address });
    expect(s.states.wallet).toMatchObject({ available: true, via: "connect" });
    expect(s.states.financial.standingAuthorization).toBe(false);
    expect(browser.cookies.has("atlas_connect_login")).toBe(false);
  });

  it("existing user keeps the same account (followers, points, reputation live on the account)", async () => {
    const w = holder("old");
    const first = await w.c.login();
    const { browser, intent } = await start();
    await prove(intent.code, w.c);
    const red = await browser.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName.toUpperCase() });
    expect(red.body).toMatchObject({ isNew: false, userId: first.userId, next: "/home" });
  });

  it("accepts an ERC-1271 smart-contract wallet and records the method", async () => {
    const w = holder("sc");
    const test = createTestClient({ chain: foundry, mode: "anvil", transport: http(h.deps.cfg.RPC_URL) });
    // minimal contract: isValidSignature(...) always returns the ERC-1271 magic value 0x1626ba7e
    await test.setCode({ address: w.c.address, bytecode: "0x631626ba7e60e01b60005260206000f3" });
    try {
      const { browser, intent } = await start();
      const ch = await handoff("challenge", { code: intent.code, wallet: w.c.address });
      const other = privateKeyToAccount(generatePrivateKey());
      const done = await handoff("complete", { code: intent.code, loginId: ch.body.loginId, signature: await w.c.signChallenge(ch.body, other) });
      expect(done.status).toBe(200);
      const [row] = await h.deps.db.sys(`SELECT proof_method FROM connect_intents WHERE id = $1`, [intent.intentId]);
      expect(row.proof_method).toBe("erc1271");
      expect((await browser.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName })).status).toBe(200);
    } finally { await test.setCode({ address: w.c.address, bytecode: "0x" }); }
  });
});

describe("ATLAS Connect: attacks and failures", () => {
  it("replay: an intent redeems exactly once, even with the original cookie replayed", async () => {
    const w = holder();
    const { browser, intent } = await start();
    const { ch } = await prove(intent.code, w.c);
    const saved = browser.cookies.get("atlas_connect_login")!;
    expect((await browser.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName })).status).toBe(200);
    const thief = new Client(h);
    thief.cookies.set("atlas_connect_login", saved);
    const again = await thief.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("CONNECT_ALREADY_USED");
    expect((await thief.get("/auth/session")).body.authenticated).toBe(false);
    // the handoff cannot re-submit, and the connect challenge is useless at /auth/verify
    expect((await handoff("complete", { code: intent.code, loginId: ch.body.loginId, signature: await w.c.signChallenge(ch.body) })).body.error).toBe("CONNECT_ALREADY_USED");
    expect((await new Client(h).post("/auth/verify", { loginId: ch.body.loginId, signature: await w.c.signChallenge(ch.body) })).body.error).toBe("CHALLENGE_NOT_FOUND");
    expect((await handoff("challenge", { code: intent.code, wallet: w.c.address })).body.error).toBe("CONNECT_ALREADY_USED");
  });

  it("expiry: after 10 minutes nothing works (handoff or browser)", async () => {
    const w = holder();
    const { browser, intent } = await start();
    await prove(intent.code, w.c);
    h.clock.offset = 601;
    try {
      expect((await browser.get(`/auth/connect/intents/${intent.intentId}`)).body.status).toBe("expired");
      const red = await browser.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName });
      expect(red.status).toBe(410);
      expect(red.body.error).toBe("CONNECT_EXPIRED");
      expect((await handoff("open", { code: intent.code })).body.error).toBe("CONNECT_EXPIRED");
    } finally { h.clock.offset = 0; }
    // a challenge issued for an intent expires with it
    const late = await start();
    const ch = await handoff("challenge", { code: late.intent.code, wallet: w.c.address });
    h.clock.offset = 301;
    try {
      const done = await handoff("complete", { code: late.intent.code, loginId: ch.body.loginId, signature: await w.c.signChallenge(ch.body) });
      expect(done.body.error).toBe("EXPIRED");
    } finally { h.clock.offset = 0; }
  });

  it("wrong browser: another browser, the handoff, or a forged verifier cannot poll or redeem", async () => {
    const w = holder();
    const { browser, intent } = await start();
    await prove(intent.code, w.c);
    const other = new Client(h);
    for (const c of [other, w.c]) {
      expect((await c.get(`/auth/connect/intents/${intent.intentId}`)).body.error).toBe("CONNECT_WRONG_BROWSER");
      expect((await c.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName })).body.error).toBe("CONNECT_WRONG_BROWSER");
    }
    other.cookies.set("atlas_connect_login", `${intent.intentId}.${"A".repeat(43)}`);
    expect((await other.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName })).status).toBe(403);
    // the other browser's own intent cookie does not unlock this intent
    const mine = await start(other);
    expect((await other.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName })).body.error).toBe("CONNECT_WRONG_BROWSER");
    expect(mine.intent.intentId).not.toBe(intent.intentId);
    expect((await other.get("/auth/session")).body.authenticated).toBe(false);
    // the rightful browser still can
    expect((await browser.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName })).status).toBe(200);
  });

  it("a leaked code proven by someone else's wallet cannot silently sign this browser in (explicit Agent ID confirmation)", async () => {
    const attacker = holder("evil");
    const { browser, intent } = await start();
    await prove(intent.code, attacker.c);
    const r = await browser.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: "victim.ai" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("CONNECT_AGENT_MISMATCH");
    expect((await browser.get(`/auth/connect/intents/${intent.intentId}`)).body.status).toBe("approved"); // user can cancel
    expect((await browser.post(`/auth/connect/intents/${intent.intentId}/cancel`)).body.ok).toBe(true);
    expect((await browser.get("/auth/session")).body.authenticated).toBe(false);
  });

  it("wrong Agent ID owner: no Agent ID at challenge, or ownership lost before completion", async () => {
    const nobody = new Client(h);
    const { intent } = await start();
    const r = await handoff("challenge", { code: intent.code, wallet: nobody.address });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("NOT_AGENT_ID_HOLDER");
    const w = holder();
    const ch = await handoff("challenge", { code: intent.code, wallet: w.c.address });
    h.deps.mockResolver!.set(w.c.address, null); // NFT transferred away after the challenge
    const done = await handoff("complete", { code: intent.code, loginId: ch.body.loginId, signature: await w.c.signChallenge(ch.body) });
    expect(done.status).toBe(403);
    expect(done.body.error).toBe("NOT_AGENT_ID_HOLDER");
    const [row] = await h.deps.db.sys(`SELECT status, wallet FROM connect_intents WHERE id = $1`, [intent.intentId]);
    expect(row).toMatchObject({ status: "pending", wallet: null });
  });

  it("signature mismatch burns the challenge; repeated failures kill the intent", async () => {
    const w = holder();
    const { browser, intent } = await start();
    const other = privateKeyToAccount(generatePrivateKey());
    for (let i = 1; i <= 5; i++) {
      const ch = await handoff("challenge", { code: intent.code, wallet: w.c.address });
      expect(ch.status).toBe(200);
      const done = await handoff("complete", { code: intent.code, loginId: ch.body.loginId, signature: await w.c.signChallenge(ch.body, other) });
      expect(done.body.error).toBe("SIGNER_MISMATCH");
      expect(done.body.details.challengeBurned).toBe(true);
      if (i === 1) {
        // the burned challenge cannot be retried, even with a correct signature
        expect((await handoff("complete", { code: intent.code, loginId: ch.body.loginId, signature: await w.c.signChallenge(ch.body) })).body.error).toBe("CONNECT_WRONG_STATE");
        const poll = await browser.get(`/auth/connect/intents/${intent.intentId}`);
        expect(poll.body).toMatchObject({ status: "pending", stage: "failed", stageDetail: { errorCode: "SIGNER_MISMATCH" } });
      }
    }
    expect((await browser.get(`/auth/connect/intents/${intent.intentId}`)).body.status).toBe("failed");
    expect((await handoff("challenge", { code: intent.code, wallet: w.c.address })).body.error).toBe("CONNECT_FAILED");
  });

  it("a superseded challenge for the same intent is rejected", async () => {
    const w = holder();
    const { intent } = await start();
    const first = await handoff("challenge", { code: intent.code, wallet: w.c.address });
    const second = await handoff("challenge", { code: intent.code, wallet: w.c.address });
    expect((await handoff("complete", { code: intent.code, loginId: first.body.loginId, signature: await w.c.signChallenge(first.body) })).body.error).toBe("CHALLENGE_CONTEXT_MISMATCH");
    expect((await handoff("complete", { code: intent.code, loginId: second.body.loginId, signature: await w.c.signChallenge(second.body) })).status).toBe(200);
  });

  it("handoff input is constrained: bad codes, free-text stages, unknown codes", async () => {
    expect((await handoff("open", { code: "ATC-nope" })).body.error).toBe("CONNECT_BAD_CODE");
    expect((await handoff("open", { code: "ATC-0123456789ABCDEFGHJKMNPQRS" })).body.error).toBe("CONNECT_NOT_FOUND");
    const { browser, intent } = await start();
    expect((await handoff("report", { code: intent.code, stage: "<script>" })).status).toBe(400);
    expect((await handoff("report", { code: intent.code, stage: "failed", bawCode: "953004" })).body.ok).toBe(true);
    expect((await browser.get(`/auth/connect/intents/${intent.intentId}`)).body).toMatchObject({ stage: "failed", stageDetail: { bawCode: "953004" } });
    expect((await handoff("report", { code: intent.code, stage: "failed", bawCode: "rm -rf" })).status).toBe(400);
  });

  it("codes and verifiers are stored hashed and the app role cannot read intents", async () => {
    const { browser, intent } = await start();
    const [row] = await h.deps.db.sys(`SELECT * FROM connect_intents WHERE id = $1`, [intent.intentId]);
    const verifier = browser.cookies.get("atlas_connect_login")!.split(".")[1]!;
    expect(JSON.stringify(row)).not.toContain(intent.code);
    expect(JSON.stringify(row)).not.toContain(verifier);
    const app = new pg.Client({ connectionString: TEST_APP_DB });
    await app.connect();
    try { await expect(app.query(`SELECT * FROM connect_intents`)).rejects.toThrow(/permission denied/); } finally { await app.end(); }
  });
});

describe("ATLAS Connect: separate states + wallet check for a signed-in session", () => {
  it("an old social session never implies the wallet is available; a connect step-up refreshes it", async () => {
    const w = holder("sx");
    await w.c.login();
    h.clock.offset = 700;
    try {
      let s = (await w.c.get("/auth/session")).body;
      expect(s.states.agentId.verified).toBe(true);
      expect(s.states.wallet).toMatchObject({ available: false, until: null });
      const { intent } = await start(w.c, "step-up");
      // a different wallet (even with its own Agent ID) cannot refresh this account's wallet check
      const x = holder("other");
      const bad = await handoff("challenge", { code: intent.code, wallet: x.c.address });
      expect(bad.body.error).toBe("WALLET_MISMATCH");
      await prove(intent.code, w.c);
      const red = await w.c.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName });
      expect(red.body).toMatchObject({ ok: true, purpose: "step-up" });
      s = (await w.c.get("/auth/session")).body;
      expect(s.states.wallet).toMatchObject({ available: true, via: "connect-step-up" });
    } finally { h.clock.offset = 0; }
  });

  it("step-up intents require a signed-in session with CSRF and are bound to it", async () => {
    expect((await new Client(h).post("/auth/connect/intents", { purpose: "step-up" })).status).toBe(401);
    const w = holder();
    await w.c.login();
    const { intent } = await start(w.c, "step-up");
    await prove(intent.code, w.c);
    // a second session of the same user (another device) holding the cookie still cannot redeem it
    const second = new Client(h, w.c.account);
    await second.login();
    second.cookies.set("atlas_connect_step_up", w.c.cookies.get("atlas_connect_step_up")!);
    expect((await second.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName })).body.error).toBe("CONNECT_WRONG_SESSION");
  });
});

describe("ATLAS Connect: payment handoff (backend never signs or moves funds)", () => {
  it("contract-call mode: handoff gets preview/execute steps; ATLAS verifies the broadcast tx against the prepared step", async () => {
    const A = holder("payer"); const B = holder("payee");
    await A.c.login(); const b = await B.c.login();
    const r = await A.c.post("/pay/handoff", { recipientUserId: b.userId, expectedRecipient: B.c.address, asset: "BNB", amount: "0.01", kind: "direct", context: { kind: "profile" } });
    expect(r.status).toBe(200);
    expect(r.body.payment).toMatchObject({ mode: "contract-call", asset: "BNB", amount: "0.01", recipient: { address: B.c.address } });
    expect(r.body.handoff.terminal).toContain(`pay ${r.body.code}`);
    const open = await handoff("open", { code: r.body.code });
    expect(open.body.steps[0].preview).toMatch(/^baw contract-call preview --binanceChainId 31337 --from /);
    expect(open.body.payment.knownIssue.issue).toContain("/issues/375");
    // pay intents have no login challenge and cannot be redeemed into a session
    expect((await handoff("challenge", { code: r.body.code, wallet: A.c.address })).body.error).toBe("CONNECT_WRONG_STATE");

    const test = createTestClient({ chain: foundry, mode: "anvil", transport: http(h.deps.cfg.RPC_URL) });
    await test.setBalance({ address: A.c.address, value: parseEther("1") });
    const wallet = createWalletClient({ account: A.c.account, chain: foundry, transport: http(h.deps.cfg.RPC_URL) });
    // a transaction that differs from the prepared step is rejected
    const wrong = await wallet.sendTransaction({ to: B.c.address, value: parseEther("0.01") });
    expect((await handoff("tx", { code: r.body.code, step: 0, txHash: wrong })).body.error).toBe("TX_MISMATCH");
    const s = r.body.payment.steps[0];
    // the exact prepared call, broadcast but reverted (mock-mode payer is not a real Agent ID owner on the local chain) → never "paid"
    const reverted = await wallet.sendTransaction({ to: s.to, data: s.data as Hex, value: BigInt(s.value), gas: 300_000n });
    const rv = await handoff("tx", { code: r.body.code, step: 0, txHash: reverted });
    expect(rv.body.error).toBe("TX_REVERTED");
    // stand-in contract code at the AtlasPay address so the same call succeeds, then restore the real code
    const payCode = await createTestClient({ chain: foundry, mode: "anvil", transport: http(h.deps.cfg.RPC_URL) }).request({ method: "eth_getCode", params: [s.to, "latest"] } as any) as Hex;
    const payBalance = await createTestClient({ chain: foundry, mode: "anvil", transport: http(h.deps.cfg.RPC_URL) }).request({ method: "eth_getBalance", params: [s.to, "latest"] } as any) as Hex;
    await test.setCode({ address: s.to, bytecode: "0x00" });
    let hash: Hex;
    try { hash = await wallet.sendTransaction({ to: s.to, data: s.data as Hex, value: BigInt(s.value), gas: 300_000n }); } finally {
      await test.setCode({ address: s.to, bytecode: payCode });
      await test.setBalance({ address: s.to, value: BigInt(payBalance) }); // leave the shared local chain exactly as it was
    }
    const ok = await handoff("tx", { code: r.body.code, step: 0, txHash: hash });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ verified: true, complete: true, mined: true });
    const poll = await A.c.get(`/auth/connect/intents/${r.body.intentId}`);
    expect(poll.body).toMatchObject({ status: "submitted", stage: "broadcast", result: { txHashes: [hash.toLowerCase()] } });
    // a tx from someone else's wallet is never accepted
    const C = privateKeyToAccount(generatePrivateKey());
    await test.setBalance({ address: C.address, value: parseEther("1") });
    const r2 = await A.c.post("/pay/handoff", { recipientUserId: b.userId, expectedRecipient: B.c.address, asset: "BNB", amount: "0.01", kind: "direct", context: { kind: "profile" } });
    const s2 = r2.body.payment.steps[0];
    const foreign = await createWalletClient({ account: C, chain: foundry, transport: http(h.deps.cfg.RPC_URL) }).sendTransaction({ to: s2.to, data: s2.data as Hex, value: BigInt(s2.value), gas: 300_000n });
    expect((await handoff("tx", { code: r2.body.code, step: 0, txHash: foreign })).body.error).toBe("TX_MISMATCH");
    expect((await handoff("tx", { code: r2.body.code, step: 0, txHash: hash })).body.error).toBe("TX_ALREADY_REPORTED");
  });

  it("requires a signed-in session with CSRF", async () => {
    expect((await new Client(h).post("/pay/handoff", { recipientUserId: "00000000-0000-4000-8000-000000000000", expectedRecipient: "0x0000000000000000000000000000000000000001", asset: "BNB", amount: "0.01", kind: "direct", context: { kind: "profile" } })).status).toBe(401);
  });
});

describe("ATLAS Connect: AtlasPay pending → official baw fallback handoff", () => {
  let p: Harness;
  beforeAll(async () => { p = await harness({ ATLAS_PAY_ADDRESS: "0x0000000000000000000000000000000000000000" }); });
  afterAll(async () => { await p?.close(); });
  it("hands off resolve → confirm (address book) → send, and verifies a plain transfer to the reviewed address", async () => {
    const A = new Client(p); const B = new Client(p);
    await A.login(uniq("fa")); const b = await B.login(uniq("fb"));
    const r = await A.post("/pay/handoff", { recipientUserId: b.userId, expectedRecipient: B.address, asset: "BNB", amount: "0.02", kind: "direct", context: { kind: "profile" } });
    expect(r.status).toBe(200);
    expect(r.body.payment.mode).toBe("fallback");
    expect(r.body.payment.addressBook).toMatch(/address book/i);
    const open = await p.app.inject({ method: "POST", url: "/auth/connect/handoff/open", payload: { code: r.body.code } });
    const steps = JSON.parse(open.body).steps;
    expect(steps.map((s: any) => s.title).join(" | ")).toMatch(/Resolve.*confirm.*Send/i);
    const test = createTestClient({ chain: foundry, mode: "anvil", transport: http(p.deps.cfg.RPC_URL) });
    await test.setBalance({ address: A.address, value: parseEther("1") });
    const wallet = createWalletClient({ account: A.account, chain: foundry, transport: http(p.deps.cfg.RPC_URL) });
    const wrongAmount = await wallet.sendTransaction({ to: B.address, value: parseEther("0.03") });
    const bad = await p.app.inject({ method: "POST", url: "/auth/connect/handoff/tx", payload: { code: r.body.code, step: 0, txHash: wrongAmount } });
    expect(JSON.parse(bad.body).error).toBe("TX_MISMATCH");
    const good = await wallet.sendTransaction({ to: B.address, value: parseEther("0.02") });
    const ok = await p.app.inject({ method: "POST", url: "/auth/connect/handoff/tx", payload: { code: r.body.code, step: 0, txHash: good } });
    expect(JSON.parse(ok.body)).toMatchObject({ verified: true, complete: true });
  });
});

describe("ATLAS Connect over MCP (/mcp/connect, public, code-gated)", () => {
  it("a real MCP client (the user's own agent) completes the handoff; the browser still has to redeem", async () => {
    await h.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = h.app.server.address() as { port: number };
    const mcp = new McpClient({ name: "atlas-connect-test-agent", version: "1.0.0" });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${addr.port}/mcp/connect`)));
    try {
      const tools = (await mcp.listTools()).tools.map((t) => t.name).sort();
      expect(tools).toEqual(["atlas_connect_challenge", "atlas_connect_complete", "atlas_connect_open", "atlas_connect_report", "atlas_connect_submit_tx"]);
      const w = holder("mcp");
      const { browser, intent } = await start();
      const text = (r: any) => JSON.parse(r.content[0].text);
      expect(text(await mcp.callTool({ name: "atlas_connect_open", arguments: { code: intent.code } })).purpose).toBe("login");
      const ch = text(await mcp.callTool({ name: "atlas_connect_challenge", arguments: { code: intent.code, wallet: w.c.address } }));
      await mcp.callTool({ name: "atlas_connect_report", arguments: { code: intent.code, stage: "awaiting_user_approval" } });
      expect((await browser.get(`/auth/connect/intents/${intent.intentId}`)).body.stage).toBe("awaiting_user_approval");
      const done = text(await mcp.callTool({ name: "atlas_connect_complete", arguments: { code: intent.code, loginId: ch.loginId, signature: await w.c.signChallenge(ch) } }));
      expect(done.status).toBe("approved");
      const bad = await mcp.callTool({ name: "atlas_connect_open", arguments: { code: "ATC-0123456789ABCDEFGHJKMNPQRS" } });
      expect(bad.isError).toBe(true);
      expect((await browser.post(`/auth/connect/intents/${intent.intentId}/redeem`, { confirmAgentName: w.agentName })).body.isNew).toBe(true);
    } finally { await mcp.close(); }
    const info = (await new Client(h).get("/mcp/info")).body;
    expect(info.connect.tools).toHaveLength(5);
  });
});
