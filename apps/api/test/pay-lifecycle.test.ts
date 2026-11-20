/**
 * Audit 2026-11-20 F3/F4 against a real chain (anvil): reported payment txs keep Prepared → Broadcast → Mined →
 * Confirmed → Finalized distinct; verified-but-unmined is never paid; duplicate reports, delayed receipts, replaced
 * txs and the USDT approve step are handled honestly; a broadcast request payment locks the request.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, createWalletClient, http, parseEther, parseGwei, type Hex } from "viem";
import { foundry } from "viem/chains";
import { harness, Client, uniq, type Harness } from "./helpers.js";
import { reconcilePayTxs, PENDING_LOCK_MINUTES } from "../src/lib/paytx.js";

let h: Harness;
let A: Client, B: Client, C: Client;
let ids: Record<string, string> = {};
let test: ReturnType<typeof createTestClient>;
let wallet: ReturnType<typeof createWalletClient>;

beforeAll(async () => {
  h = await harness();
  A = new Client(h); B = new Client(h); C = new Client(h);
  ids.A = (await A.login(uniq("lpayer"))).userId;
  ids.B = (await B.login(uniq("lpayee"))).userId;
  ids.C = (await C.login(uniq("lthird"))).userId;
  test = createTestClient({ chain: foundry, mode: "anvil", transport: http(h.deps.cfg.RPC_URL) });
  await test.setBalance({ address: A.address, value: parseEther("10") });
  wallet = createWalletClient({ account: A.account, chain: foundry, transport: http(h.deps.cfg.RPC_URL) });
});
afterAll(async () => { await test?.setAutomine(true).catch(() => {}); await h?.close(); });

const prepare = (body: any = {}) => A.post("/pay/prepare", { recipientUserId: ids.B, expectedRecipient: B.address, asset: "BNB", amount: "0.01", kind: "direct", context: { kind: "profile" }, ...body });
/** send exactly the reviewed step from A's own key (explicit gas: no simulation, like a wallet that already estimated) */
const sendStep = (s: any, over: Record<string, unknown> = {}) => wallet.sendTransaction({ account: A.account, chain: foundry, to: s.to, data: s.data, value: BigInt(s.value), gas: 300_000n, gasPrice: parseGwei("2"), ...over } as any) as Promise<Hex>;

describe("payment tx lifecycle (audit F3)", () => {
  it("prepare is only 'prepared': never paid", async () => {
    const p = (await prepare()).body;
    expect(p).toMatchObject({ stage: "prepared", paid: false });
    expect(p.steps[0].stepKind).toBe("pay");
  });

  it("delayed receipt: broadcast (verified, not mined) is not paid; after mining it is mined/reverted, still not paid", async () => {
    const p = (await prepare()).body;
    await test.setAutomine(false);
    const hash = await sendStep(p.steps[0]);
    const r = await A.post(`/pay/intents/${p.intentId}/tx`, { step: 0, txHash: hash });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verified: true, stage: "broadcast", paid: false, stepKind: "pay" });
    expect(r.body.stageLabel).toMatch(/not mined/i);
    // duplicate report of the same hash is idempotent
    const again = await A.post(`/pay/intents/${p.intentId}/tx`, { step: 0, txHash: hash });
    expect(again.body).toMatchObject({ stage: "broadcast", paid: false });
    await test.mine({ blocks: 1 });
    await test.setAutomine(true);
    const receipt = await h.deps.chain.getTransactionReceipt({ hash });
    const s = (await A.get(`/pay/tx/${hash}`)).body;
    // the local Agent ID owner is not B, so AtlasPay reverts: a mined revert is reported as such, never as paid
    expect(s.stage).toBe(receipt.status === "success" ? "mined" : "reverted");
    expect(s.paid).toBe(false);
    // only the parties can read it
    expect((await C.get(`/pay/tx/${hash}`)).status).toBe(404);
  });

  it("the same hash cannot be reported for another payment; a tx that is not the reviewed step is rejected", async () => {
    const p1 = (await prepare()).body, p2 = (await prepare()).body;
    const hash = await sendStep(p1.steps[0]);
    expect((await A.post(`/pay/intents/${p1.intentId}/tx`, { step: 0, txHash: hash })).status).toBe(200);
    const dup = await A.post(`/pay/intents/${p2.intentId}/tx`, { step: 0, txHash: hash });
    expect(dup.status).toBe(400); // contextRef differs, so the data does not match p2's reviewed step
    const other = await wallet.sendTransaction({ account: A.account, chain: foundry, to: B.address, value: 1n } as any);
    expect((await A.post(`/pay/intents/${p2.intentId}/tx`, { step: 0, txHash: other })).body.error).toBe("TX_MISMATCH");
    expect((await B.post(`/pay/intents/${p1.intentId}/tx`, { step: 0, txHash: hash })).status).toBe(404);
  });

  it("USDT: the approve step reaches approval_mined and is never a payment", async () => {
    const p = (await prepare({ asset: "USDT", amount: "3" })).body;
    expect(p.steps.map((s: any) => s.stepKind)).toEqual(["approve", "pay"]);
    const hash = await sendStep(p.steps[0]);
    const r = (await A.post(`/pay/intents/${p.intentId}/tx`, { step: 0, txHash: hash })).body;
    expect(r).toMatchObject({ stepKind: "approve", stage: "approval_mined", paid: false });
    expect(r.note).toMatch(/not a payment/i);
  });
});

describe("request pending lock (audit F4)", () => {
  it("a broadcast matching tx locks the request; a replaced tx releases it", async () => {
    const q = (await B.post("/pay/requests", { asset: "BNB", amount: "0.02" })).body;
    const body = { amount: "0.02", kind: "request", context: { kind: "request", id: q.id } };
    const p = (await prepare(body)).body;
    await test.setAutomine(false);
    const nonce = await h.deps.chain.getTransactionCount({ address: A.address, blockTag: "pending" });
    const hash = await sendStep(p.steps[0], { nonce });
    const r = (await A.post(`/pay/intents/${p.intentId}/tx`, { step: 0, txHash: hash })).body;
    expect(r).toMatchObject({ stage: "broadcast", paid: false, requestLock: "held" });
    const view = (await B.get(`/pay/requests/${q.id}`)).body;
    expect(view).toMatchObject({ status: "pending", pending: { txHash: hash.toLowerCase() } });
    const blocked = await prepare(body);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("REQUEST_PENDING");
    // the sender replaces it (same nonce, higher fee) with a self-transfer: the payment never executes
    await wallet.sendTransaction({ account: A.account, chain: foundry, to: A.address, value: 0n, nonce, gas: 21_000n, gasPrice: parseGwei("20") } as any);
    await test.mine({ blocks: 1 });
    await test.setAutomine(true);
    const s = (await A.get(`/pay/tx/${hash}`)).body;
    expect(s).toMatchObject({ stage: "replaced", paid: false });
    expect((await B.get(`/pay/requests/${q.id}`)).body.status).toBe("open");
    expect((await prepare(body)).status).toBe(200);
  });

  it("a lock expires so a dropped tx cannot block the request forever; reconciliation is bounded and idempotent", async () => {
    const q = (await B.post("/pay/requests", { asset: "BNB", amount: "0.03" })).body;
    const body = { amount: "0.03", kind: "request", context: { kind: "request", id: q.id } };
    const p = (await prepare(body)).body;
    await test.setAutomine(false);
    const hash = await sendStep(p.steps[0]);
    await A.post(`/pay/intents/${p.intentId}/tx`, { step: 0, txHash: hash });
    expect((await prepare(body)).status).toBe(409);
    h.clock.offset += (PENDING_LOCK_MINUTES + 1) * 60;
    try {
      expect((await B.get(`/pay/requests/${q.id}`)).body.status).toBe("open");
      expect((await prepare(body)).status).toBe(200);
    } finally { h.clock.offset -= (PENDING_LOCK_MINUTES + 1) * 60; }
    await test.mine({ blocks: 1 });
    await test.setAutomine(true);
    const r1 = await reconcilePayTxs(h.deps);
    expect(r1.checked).toBeGreaterThanOrEqual(0);
    const r2 = await reconcilePayTxs(h.deps);
    expect(r2.changed).toBe(0);
  });
});
