/**
 * End-to-end against a local anvil chain with the ATLAS contracts + MockAgentID (deployments/31337.json).
 * Covers: on-chain identity fallback login, publishing a thesis, a second holder reviewing it on-chain,
 * immutability checks, reorg-aware indexing into Postgres. Skipped when anvil is not running.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createWalletClient, createTestClient, http, parseEther, type Hex } from "viem";
import { foundry } from "viem/chains";
import { MockAgentIDAbi, MockStableAbi } from "@atlas/shared-types";
import { harness, Client, uniq, type Harness } from "./helpers.js";
import { createIndexer } from "../src/workers/indexer.js";

const RPC = process.env.ANVIL_RPC ?? "http://127.0.0.1:8545";
const up = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }).then((r) => r.ok).catch(() => false);

let h: Harness;
const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });

async function holder(h: Harness) {
  const c = new Client(h);
  await testClient.setBalance({ address: c.address, value: parseEther("10") });
  const w = createWalletClient({ account: c.account, chain: foundry, transport: http(RPC) });
  const hash = await w.writeContract({ address: h.deps.contracts.agentId, abi: MockAgentIDAbi, functionName: "register", args: [uniq("holder")] });
  await h.deps.chain.waitForTransactionReceipt({ hash });
  return { c, w };
}
async function send(h: Harness, w: any, tx: { to: Hex; data: Hex }) {
  const hash = await w.sendTransaction({ to: tx.to, data: tx.data, value: 0n });
  const r = await h.deps.chain.waitForTransactionReceipt({ hash });
  expect(r.status).toBe("success");
  return hash as Hex;
}

describe.skipIf(!up)("on-chain flows (anvil)", () => {
  beforeAll(async () => { h = await harness({ AGENT_ID_MODE: "onchain", RPC_URL: RPC }); });
  afterAll(async () => { await h?.close(); });

  it("logs in with an EIP-712 signature against the on-chain Agent ID", async () => {
    const { c } = await holder(h);
    const r = await c.login();
    expect(r.isNew).toBe(true);
    expect(r.agentName).toMatch(/^holder.*\.ai$/);
  });

  it("logs in via the on-chain registerIdentity fallback (no typed-data signing)", async () => {
    const { c, w } = await holder(h);
    const ch = await c.post("/auth/challenge", { wallet: c.address });
    const early = await c.post("/auth/verify", { loginId: ch.body.loginId, mode: "onchain" });
    expect(early.body.error).toBe("PROOF_PENDING");
    await send(h, w, ch.body.onchainFallback.transaction);
    const v = await c.post("/auth/verify", { loginId: ch.body.loginId, mode: "onchain" });
    expect(v.status).toBe(200);
    expect(v.body.method).toBe("onchain");
    // the same proof cannot be reused
    expect((await new Client(h).post("/auth/verify", { loginId: ch.body.loginId, mode: "onchain" })).body.error).toBe("ALREADY_USED");
  });

  it("a holder publishes a thesis on-chain; a second holder reviews it; the commitment cannot change", async () => {
    const author = await holder(h);
    const reviewer = await holder(h);
    await author.c.login();
    await reviewer.c.login();
    const price = (await author.c.get("/markets/BNB")).body.ticker.lastPrice as number;
    const draft = await author.c.post("/theses", {
      asset: "BNB", direction: "LONG", targetPrice: (price * 1.05).toFixed(2), invalidationPrice: (price * 0.97).toFixed(2), horizonHours: 72,
      title: "BNB breakout watch", summary: "Volume building under resistance with higher lows.", body: "Details...", confidence: 62,
    });
    expect(draft.status).toBe(200);
    expect(draft.body.thesis.badge).toBe("Draft (not on-chain)");
    // drafts are private
    expect((await reviewer.c.get(`/theses/${draft.body.thesis.id}`)).status).toBe(404);

    const prep = await author.c.post(`/theses/${draft.body.thesis.id}/prepare`);
    expect(prep.body.transaction.value).toBe("0");
    expect(prep.body.baw.preview).toMatch(/baw contract-call preview/);
    const tx = await send(h, author.w, prep.body.transaction);
    const conf = await author.c.post(`/theses/${draft.body.thesis.id}/confirm`, { txHash: tx });
    expect(conf.status).toBe(200);
    expect(conf.body.thesis.badge).toBe("On-chain Committed");

    // a different account cannot confirm someone else's tx for its own thesis
    expect((await reviewer.c.post(`/theses/${draft.body.thesis.id}/confirm`, { txHash: tx })).status).toBe(403);

    // immutability: no re-publish, and proofs recompute the original commitment from the chain
    expect((await author.c.post(`/theses/${draft.body.thesis.id}/prepare`)).body.error).toBe("ALREADY_ONCHAIN");
    const proofs = (await reviewer.c.get(`/theses/${draft.body.thesis.id}/proofs`)).body;
    const ok = Object.fromEntries(proofs.checks.map((c: any) => [c.name, c.ok]));
    expect(ok).toMatchObject({ commitment: true, contentHash: true, methodology: true, onchainCommitmentUnchanged: true, onchainAuthor: true });

    // author cannot review own thesis; reviewer publishes an attributable on-chain review
    expect((await author.c.post(`/theses/${draft.body.thesis.id}/reviews`, { stance: "ENDORSE", body: "great" })).body.error).toBe("SELF_REVIEW");
    const rev = await reviewer.c.post(`/theses/${draft.body.thesis.id}/reviews`, { stance: "DISPUTE", body: "Volume is fading; resistance has rejected three times." });
    expect(rev.body.onchain.transaction.to).toBe(h.deps.contracts.review);
    const rtx = await send(h, reviewer.w, rev.body.onchain.transaction);
    expect((await reviewer.c.post(`/theses/${draft.body.thesis.id}/reviews/confirm`, { txHash: rtx })).status).toBe(200);
    const reviews = (await author.c.get(`/theses/${draft.body.thesis.id}/reviews`)).body.reviews;
    expect(reviews[0]).toMatchObject({ stance: "DISPUTE", onchain: true });

    // the thesis appears in the Verified feed
    const verified = (await reviewer.c.get("/feed?tab=verified")).body.items;
    expect(verified.some((p: any) => p.thesis?.id === draft.body.thesis.id)).toBe(true);
  });

  it("the Postgres-backed indexer ingests ATLAS events and reconciles a reorg", async () => {
    const ix = createIndexer(h.deps, { confirmations: 20 });
    const drain = async () => { for (let i = 0; i < 50; i++) if ((await ix.step()).caughtUp) break; };
    await drain();
    const count = async () => (await h.deps.db.sys(`SELECT count(*)::int AS n FROM chain_events WHERE chain_id = 31337 AND name = 'IdentityRegistered'`))[0].n as number;
    const base = await count();
    expect(base).toBeGreaterThan(0);

    // a provisional identity proof lands, then the chain reorganises it away (anvil snapshot/revert)
    const snap = await testClient.snapshot();
    const { c, w } = await holder(h);
    const ch = await c.post("/auth/challenge", { wallet: c.address });
    await send(h, w, ch.body.onchainFallback.transaction);
    await drain();
    expect(await count()).toBe(base + 1);
    const [prov] = await h.deps.db.sys(`SELECT status FROM chain_events WHERE name = 'IdentityRegistered' ORDER BY block_number DESC LIMIT 1`);
    expect(prov.status).toBe("provisional");
    await testClient.revert({ id: snap });
    await testClient.mine({ blocks: 4 });
    await drain();
    expect(await count()).toBe(base); // orphaned provisional event removed
  });
  it("ATLAS Pay: BNB + USDT through the real AtlasPay contract; receipts come from indexed events (reorg-aware)", async () => {
    const a = await holder(h);
    const b = await holder(h);
    await a.c.login();
    const bid = (await b.c.login()).userId;
    const rcpt = await a.c.post("/pay/recipient", { recipientUserId: bid });
    expect(rcpt.body.address).toBe(b.c.address);
    expect(rcpt.body.addressType).toBe("EOA");
    const bal0 = await h.deps.chain.getBalance({ address: b.c.address });
    const nat = await a.c.post("/pay/prepare", { recipientUserId: bid, expectedRecipient: rcpt.body.address, asset: "BNB", amount: "0.25", kind: "direct", context: { kind: "profile" } });
    expect(nat.status).toBe(200);
    expect(nat.body.gasEstimate.estimated).toBe(true);
    const s0 = nat.body.steps[0];
    const tx1 = await a.w.sendTransaction({ to: s0.to, data: s0.data, value: BigInt(s0.value) });
    expect((await h.deps.chain.waitForTransactionReceipt({ hash: tx1 })).status).toBe("success");
    expect((await h.deps.chain.getBalance({ address: b.c.address })) - bal0).toBe(parseEther("0.25"));
    expect(await h.deps.chain.getBalance({ address: h.deps.contracts.pay })).toBe(0n);

    // USDT (MockStable locally): exact approve, then payToken
    await h.deps.chain.waitForTransactionReceipt({ hash: await a.w.writeContract({ address: h.deps.contracts.stable, abi: MockStableAbi, functionName: "mint", args: [a.c.address, parseEther("100")] }) });
    const tok = await a.c.post("/pay/prepare", { recipientUserId: bid, expectedRecipient: rcpt.body.address, asset: "USDT", amount: "3", kind: "direct", context: { kind: "profile" } });
    expect(tok.body.steps).toHaveLength(2);
    for (const s of tok.body.steps) await send(h, a.w, s);
    const usdtOf = (x: Hex) => h.deps.chain.readContract({ address: h.deps.contracts.stable, abi: MockStableAbi, functionName: "balanceOf", args: [x] }) as Promise<bigint>;
    expect(await usdtOf(b.c.address)).toBe(parseEther("3"));
    expect(await usdtOf(h.deps.contracts.pay)).toBe(0n);

    const ix = createIndexer(h.deps, { confirmations: 20 });
    const drain = async () => { for (let i = 0; i < 50; i++) if ((await ix.step()).caughtUp) break; };
    await drain();
    const mine = (await a.c.get("/pay/receipts")).body.items.filter((r: any) => [tx1.toLowerCase()].includes(r.txHash) || r.asset === "USDT");
    expect(mine.map((r: any) => `${r.asset}:${r.amount}:${r.direction}`).sort()).toEqual(["BNB:0.25:sent", "USDT:3:sent"]);
    expect(mine.every((r: any) => r.status === "provisional" && r.context?.kind === "profile")).toBe(true);
    expect((await b.c.get("/pay/receipts?direction=received")).body.items).toHaveLength(2);

    // a payment that gets reorganised away disappears from receipts
    const snap = await testClient.snapshot();
    const again = await a.c.post("/pay/prepare", { recipientUserId: bid, expectedRecipient: rcpt.body.address, asset: "BNB", amount: "0.01", kind: "direct", context: { kind: "profile" } });
    await a.w.sendTransaction({ to: again.body.steps[0].to, data: again.body.steps[0].data, value: BigInt(again.body.steps[0].value) }).then((hash: Hex) => h.deps.chain.waitForTransactionReceipt({ hash }));
    await drain();
    expect((await b.c.get("/pay/receipts")).body.items).toHaveLength(3);
    await testClient.revert({ id: snap });
    await testClient.mine({ blocks: 4 });
    await drain();
    expect((await b.c.get("/pay/receipts")).body.items).toHaveLength(2);
    // once deep enough, receipts are final
    await testClient.mine({ blocks: 25 });
    await drain();
    expect((await b.c.get("/pay/receipts")).body.items.every((r: any) => r.status === "final")).toBe(true);
  });
});
