/**
 * ATLAS Pay API: honest pending state, send-flow-only recipient resolution (rate-limited, not a lookup tool),
 * unsigned tx preparation, requests, receipts projected from chain events (reorg-safe), and Arena isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { decodeFunctionData, keccak256, toBytes, type Hex } from "viem";
import { AtlasPayAbi } from "@atlas/shared-types/abi";
import { ERC20_ABI } from "@atlas/wallet-integration";
import { harness, Client, uniq, type Harness } from "./helpers.js";
import { applyPayEvent } from "../src/lib/pay.js";

let h: Harness;
let A: Client, B: Client, C: Client, N: Client;
let ids: Record<string, string> = {};
let hA = "", hB = "";

beforeAll(async () => {
  h = await harness();
  A = new Client(h); B = new Client(h); C = new Client(h);
  hA = uniq("payer"); hB = uniq("payee");
  ids.A = (await A.login(hA)).userId;
  ids.B = (await B.login(hB)).userId;
  ids.C = (await C.login(uniq("third"))).userId;
  N = new Client(h); // never signs in with an Agent ID
});
afterAll(async () => { await h?.close(); });

const prepare = (c: Client, body: any) => c.post("/pay/prepare", { recipientUserId: ids.B, asset: "BNB", amount: "0.05", kind: "direct", context: { kind: "profile" }, ...body });

describe("ATLAS Pay config + recipient resolution", () => {
  it("reports deployment status and assets honestly", async () => {
    const r = await A.get("/pay/config");
    expect(r.body.status).toBe("deployed");
    expect(r.body.assets.map((a: any) => a.symbol)).toEqual(["BNB", "USDT"]);
    expect(r.body.assets[1].isMock).toBe(true); // local MockStable is labelled
    expect(r.body.reputation).toMatch(/never change Skill Score/);
  });

  it("resolves ONE recipient profile inside the send flow to the current Agent ID owner", async () => {
    const r = await A.post("/pay/recipient", { recipientUserId: ids.B });
    expect(r.status).toBe(200);
    expect(r.body.address).toBe(B.address);
    expect(r.body.tokenId).toBe(BigInt(keccak256(toBytes(hB))).toString());
    expect(r.body.recipient.agentName).toBe(`${hB}.ai`);
    const [ev] = await h.deps.db.sys(`SELECT detail FROM security_events WHERE user_id = $1 AND kind = 'pay_resolve' ORDER BY id DESC LIMIT 1`, [ids.A]);
    expect(ev.detail.recipientId).toBe(ids.B); // audited
  });

  it("is not a lookup tool: auth + CSRF + Agent ID required, profile id only, no GET, no names", async () => {
    expect((await N.post("/pay/recipient", { recipientUserId: ids.B })).status).toBe(401);
    expect((await A.req("POST", "/pay/recipient", { recipientUserId: ids.B }, { "x-atlas-csrf": "nope" })).status).toBe(403);
    expect((await A.get(`/pay/recipient?recipientUserId=${ids.B}`)).status).toBe(404);
    expect((await A.post("/pay/recipient", { agentName: `${hB}.ai` })).status).toBe(400);
    expect((await A.post("/pay/recipient", { recipientUserId: ids.A })).body.error).toBe("SELF_PAYMENT");
    expect((await A.post("/pay/recipient", { recipientUserId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    // a request card never exposes an address
    const q = await B.post("/pay/requests", { asset: "BNB", amount: "0.01" });
    expect(JSON.stringify((await N.get(`/pay/requests/${q.body.id}`)).body)).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });

  it("is rate-limited per user (10/min) and caps distinct recipients per day", async () => {
    const R = new Client(h);
    await R.login(uniq("rl"));
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await R.post("/pay/recipient", { recipientUserId: ids.B })).status;
    expect(last).toBe(429);
    // distinct-recipient cap
    const S = new Client(h);
    const sid = (await S.login(uniq("cap"))).userId;
    for (let i = 0; i < 25; i++) await h.deps.db.sys(`INSERT INTO security_events (user_id, kind, detail) VALUES ($1,'pay_resolve',$2)`, [sid, { recipientId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }]);
    const r = await S.post("/pay/recipient", { recipientUserId: ids.B });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("RESOLVE_LIMIT");
  });

  it("respects opt-out and blocks", async () => {
    const D = new Client(h);
    const did = (await D.login(uniq("optout"))).userId;
    await D.req("PUT", "/pay/settings", { acceptPayments: false });
    expect((await C.post("/pay/recipient", { recipientUserId: did })).body.error).toBe("PAYMENTS_DISABLED");
    await D.req("PUT", "/pay/settings", { acceptPayments: true });
    await D.post("/blocks", {}).catch(() => {});
    await h.deps.db.sys(`INSERT INTO blocks (user_id, blocked_id) VALUES ($1,$2)`, [did, ids.C]);
    expect((await C.post("/pay/recipient", { recipientUserId: did })).body.error).toBe("BLOCKED");
  });
});

describe("prepare unsigned payments", () => {
  it("BNB: one payNative call to AtlasPay carrying exactly the amount and the shown recipient", async () => {
    const r = await prepare(A, { expectedRecipient: B.address });
    expect(r.status).toBe(200);
    expect(r.body.steps).toHaveLength(1);
    const s = r.body.steps[0];
    expect(s.to).toBe(h.deps.contracts.pay);
    expect(s.value).toBe("50000000000000000");
    const d = decodeFunctionData({ abi: AtlasPayAbi, data: s.data });
    expect(d.functionName).toBe("payNative");
    expect((d.args![0] as any).expectedRecipient).toBe(B.address);
    expect((d.args![0] as any).contextRef).toBe(r.body.contextRef);
    expect(s.baw.preview).toContain(`--to ${h.deps.contracts.pay}`);
    expect(r.body.gasEstimate.gas).toMatch(/^\d+$/);
    expect(r.body.notice).toMatch(/never signs, never holds funds/);
  });

  it("USDT: exact-amount approve (never unlimited) then payToken", async () => {
    const r = await prepare(A, { expectedRecipient: B.address, asset: "USDT", amount: "12.5" });
    expect(r.body.steps.map((s: any) => s.to)).toEqual([h.deps.contracts.stable, h.deps.contracts.pay]);
    const ap = decodeFunctionData({ abi: ERC20_ABI, data: r.body.steps[0].data });
    expect(ap.args).toEqual([h.deps.contracts.pay, 12500000000000000000n]);
    expect(decodeFunctionData({ abi: AtlasPayAbi, data: r.body.steps[1].data }).functionName).toBe("payToken");
    expect(r.body.stableIsMock).toBe(true);
  });

  it("refuses when the shown address is no longer the Agent ID owner", async () => {
    const r = await prepare(A, { expectedRecipient: C.address });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("RECIPIENT_CHANGED");
    expect(r.body.details.current).toBe(B.address);
  });

  it("tips only go to the author of that post; amounts are validated", async () => {
    const p = await B.post("/posts", { body: "payee research note #bnb" });
    const ok = await prepare(A, { expectedRecipient: B.address, kind: "tip", context: { kind: "post", id: p.body.id } });
    expect(ok.status).toBe(200);
    const pc = await C.post("/posts", { body: "someone else's post" });
    expect((await prepare(A, { expectedRecipient: B.address, kind: "tip", context: { kind: "post", id: pc.body.id } })).body.error).toBe("BAD_CONTEXT");
    expect((await prepare(A, { expectedRecipient: B.address, kind: "tip", context: { kind: "profile" } })).body.error).toBe("BAD_CONTEXT");
    for (const amount of ["0", "-1", "1e3", "0.0000000000000000001", "abc"]) expect((await prepare(A, { expectedRecipient: B.address, amount })).status).toBe(400);
  });

  it("DM payments require both people in the conversation", async () => {
    await B.post("/follows", { userId: ids.A });
    const m = await A.post("/messages", { to: ids.B, body: "lunch was great, sending my half" });
    const conv = m.body.conversationId;
    expect((await prepare(A, { expectedRecipient: B.address, context: { kind: "dm", id: conv } })).status).toBe(200);
    expect((await C.post("/pay/prepare", { recipientUserId: ids.B, expectedRecipient: B.address, asset: "BNB", amount: "1", kind: "direct", context: { kind: "dm", id: conv } })).body.error).toBe("NOT_MEMBER");
  });

  it("non-holders cannot prepare and nobody can pay themselves", async () => {
    expect((await N.post("/pay/prepare", { recipientUserId: ids.B, expectedRecipient: B.address, asset: "BNB", amount: "1", kind: "direct", context: { kind: "profile" } })).status).toBe(401);
    expect((await A.post("/pay/prepare", { recipientUserId: ids.A, expectedRecipient: A.address, asset: "BNB", amount: "1", kind: "direct", context: { kind: "profile" } })).body.error).toBe("SELF_PAYMENT");
  });
});

describe("payment requests", () => {
  it("creates a shareable request; the payer authorizes it independently; amount/asset are binding", async () => {
    const q = await B.post("/pay/requests", { asset: "USDT", amount: "25", note: "Research bounty: BNB liquidity map" });
    expect(q.status).toBe(200);
    expect(q.body.shareUrl).toMatch(new RegExp(`/pay/r/${q.body.id}$`));
    const pub = await N.get(`/pay/requests/${q.body.id}`);
    expect(pub.body).toMatchObject({ asset: "USDT", amount: "25", status: "open", viewer: { canPay: false } });
    expect((await A.get(`/pay/requests/${q.body.id}`)).body.viewer.canPay).toBe(true);
    expect((await prepare(A, { expectedRecipient: B.address, asset: "USDT", amount: "24", kind: "request", context: { kind: "request", id: q.body.id } })).body.error).toBe("REQUEST_MISMATCH");
    const ok = await prepare(A, { expectedRecipient: B.address, asset: "USDT", amount: "25", kind: "request", context: { kind: "request", id: q.body.id } });
    expect(ok.status).toBe(200);
  });

  it("DM requests are visible only to conversation members; cancel is requester-only", async () => {
    const m = await A.post("/messages", { to: ids.B, body: "invoice incoming" });
    const q = await B.post("/pay/requests", { asset: "BNB", amount: "0.2", context: { kind: "dm", id: m.body.conversationId } });
    expect(q.body.payerId).toBe(ids.A);
    expect((await A.get(`/pay/requests/${q.body.id}`)).status).toBe(200);
    expect((await C.get(`/pay/requests/${q.body.id}`)).status).toBe(404);
    expect((await N.get(`/pay/requests/${q.body.id}`)).status).toBe(404);
    expect((await C.post("/pay/prepare", { recipientUserId: ids.B, expectedRecipient: B.address, asset: "BNB", amount: "0.2", kind: "request", context: { kind: "request", id: q.body.id } })).body.error).toBe("NOT_PAYER");
    expect((await A.post(`/pay/requests/${q.body.id}/cancel`)).status).toBe(404);
    expect((await B.post(`/pay/requests/${q.body.id}/cancel`)).status).toBe(200);
    expect((await prepare(A, { expectedRecipient: B.address, amount: "0.2", kind: "request", context: { kind: "request", id: q.body.id } })).body.error).toBe("REQUEST_CLOSED");
  });

  it("requests can only be attached to your own posts", async () => {
    const p = await C.post("/posts", { body: "not yours" });
    expect((await B.post("/pay/requests", { asset: "BNB", amount: "1", context: { kind: "post", id: p.body.id } })).body.error).toBe("NOT_AUTHOR");
    expect((await N.post("/pay/requests", { asset: "BNB", amount: "1" })).status).toBe(401);
  });
});

describe("receipts from indexed PaymentSent events", () => {
  async function emit(intent: any, over: Partial<{ amount: bigint; recipient: string }> = {}, block = 100n) {
    const id = `0x${"ab".repeat(32)}:${Math.floor(Math.random() * 1e9)}`;
    const txHash = `0x${Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64)}` as Hex;
    const args = { sender: A.address, recipient: over.recipient ?? B.address, contextRef: intent.contextRef, senderTokenId: BigInt(keccak256(toBytes(hA))), recipientTokenId: BigInt(intent.recipient.tokenId), token: intent.asset === "BNB" ? "0x0000000000000000000000000000000000000000" : h.deps.contracts.stable, amount: over.amount ?? BigInt(intent.amountWei), kind: ["direct", "tip", "request"].indexOf(intent.kind), memoHash: intent.memoHash };
    const ev = { id, name: "PaymentSent", args, txHash, blockNumber: block, blockTime: BigInt(Math.floor(Date.now() / 1000)), address: h.deps.contracts.pay };
    await h.deps.db.sysTx(async (q) => {
      await q(`INSERT INTO chain_events (id, chain_id, contract, name, args, address, block_number, block_hash, block_time, log_index, tx_hash, status) VALUES ($1,$2,'pay','PaymentSent','{}',$3,$4,$5,now(),0,$6,'provisional')`, [id, h.deps.contracts.chainId, h.deps.contracts.pay.toLowerCase(), block.toString(), `0x${"ab".repeat(32)}`, txHash]);
      await applyPayEvent(q, h.deps, ev, "provisional");
    });
    return { id, txHash, ev };
  }

  it("shows receipts to both parties only, with context refs but never message content", async () => {
    const m = await A.post("/messages", { to: ids.B, body: "SECRET-DM-CONTENT do not leak" });
    const intent = (await prepare(A, { expectedRecipient: B.address, context: { kind: "dm", id: m.body.conversationId }, memo: "split" })).body;
    const { id } = await emit(intent);
    const sent = (await A.get("/pay/receipts?direction=sent")).body.items.find((x: any) => x.id === id);
    expect(sent).toMatchObject({ direction: "sent", status: "provisional", asset: "BNB", amount: "0.05", kind: "direct", context: { kind: "dm", id: m.body.conversationId }, memo: "split" });
    expect(sent.sender.agentName).toBe(`${hA}.ai`);
    expect(sent.recipient.agentName).toBe(`${hB}.ai`);
    const got = (await B.get("/pay/receipts?direction=received")).body.items.find((x: any) => x.id === id);
    expect(got.direction).toBe("received");
    expect(JSON.stringify((await A.get("/pay/receipts")).body)).not.toContain("SECRET-DM-CONTENT");
    expect((await C.get("/pay/receipts")).body.items.find((x: any) => x.id === id)).toBeUndefined();
    expect((await C.get(`/pay/receipts/${encodeURIComponent(id)}`)).status).toBe(404);
    // RLS: even raw app-role reads cannot see someone else's receipt
    expect(await h.deps.db.as(ids.C, (q) => q(`SELECT 1 FROM payments WHERE event_id = $1`, [id]))).toHaveLength(0);
  });

  it("an event that disagrees with what the sender was shown is not linked to the intent", async () => {
    const intent = (await prepare(A, { expectedRecipient: B.address })).body;
    const { id } = await emit(intent, { amount: 1n });
    const x = (await A.get("/pay/receipts")).body.items.find((r: any) => r.id === id);
    expect(x.context).toBeNull();
  });

  it("settles a request on PaymentSent and re-opens it if a reorg removes the event", async () => {
    const q = await B.post("/pay/requests", { asset: "BNB", amount: "0.3" });
    const intent = (await prepare(A, { expectedRecipient: B.address, amount: "0.3", kind: "request", context: { kind: "request", id: q.body.id } })).body;
    const { id, txHash, ev } = await emit(intent);
    expect((await N.get(`/pay/requests/${q.body.id}`)).body).toMatchObject({ status: "paid", paidTxHash: txHash.toLowerCase() });
    // reorg: the indexer deletes the event (payments cascade) and reverts its effects
    await h.deps.db.sysTx(async (qq) => {
      await qq(`DELETE FROM chain_events WHERE id = $1`, [id]);
      await applyPayEvent(qq, h.deps, ev, "provisional", true);
    });
    expect((await N.get(`/pay/requests/${q.body.id}`)).body.status).toBe("open");
    expect((await A.get("/pay/receipts")).body.items.find((r: any) => r.id === id)).toBeUndefined();
  });

  it("payments and tips never change Arena score, points, levels or achievements", async () => {
    const p = await B.post("/posts", { body: "tip me maybe" });
    const arena = async () => { const { calculatedAt: _t, ...rest } = (await N.get(`/users/${ids.B}/arena`)).body; return { ...rest, breakdown: (await N.get(`/users/${ids.B}/score-breakdown`)).body?.score ?? null }; };
    const before = { b: await arena(), pts: await h.deps.db.sys(`SELECT count(*)::int AS n FROM point_events`) };
    const intent = (await prepare(A, { expectedRecipient: B.address, kind: "tip", context: { kind: "post", id: p.body.id }, amount: "5" })).body;
    expect(intent.kind).toBe("tip");
    for (let i = 0; i < 3; i++) await emit(intent, {}, BigInt(200 + i));
    const after = { b: await arena(), pts: await h.deps.db.sys(`SELECT count(*)::int AS n FROM point_events`) };
    expect(after.b).toEqual(before.b);
    expect(after.pts[0].n).toBe(before.pts[0].n);
    // and no scoring code reads payment tables
    const { readdirSync, readFileSync } = await import("node:fs");
    const files = ["../../services/reputation-engine/src", "../../services/outcome-engine/src"].flatMap((d) => readdirSync(new URL(`../${d}/`, import.meta.url)).map((f) => readFileSync(new URL(`../${d}/${f}`, import.meta.url), "utf8")));
    files.push(readFileSync(new URL("../src/lib/arena.ts", import.meta.url), "utf8"));
    for (const src of files) expect(src).not.toMatch(/payments|payment_intents|payment_requests|PaymentSent/);
  });
});

describe("contracts pending (live beta before AtlasPay is deployed)", () => {
  let p: Harness;
  let X: Client, Y: Client;
  let yid = "";
  beforeAll(async () => {
    await h.close();
    p = await harness({ ATLAS_PAY_ADDRESS: "0x0000000000000000000000000000000000000000" });
    h = p;
    X = new Client(p); Y = new Client(p);
    await X.login(uniq("px"));
    yid = (await Y.login(uniq("py"))).userId;
  });

  it("says so honestly and refuses to prepare instead of faking a payment", async () => {
    const cfg = (await X.get("/pay/config")).body;
    expect(cfg.status).toBe("pending");
    expect(cfg.contract).toBeNull();
    expect(cfg.pendingMessage).toMatch(/pending deployment/);
    const r = await X.post("/pay/prepare", { recipientUserId: yid, expectedRecipient: Y.address, asset: "BNB", amount: "1", kind: "direct", context: { kind: "profile" } });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("CONTRACTS_PENDING");
    expect(r.body.details.fallback).toBe("baw");
  });

  it("offers the official baw flow: resolve first, then send to the resolved address", async () => {
    const r = await X.post("/pay/fallback", { recipientUserId: yid, asset: "USDT", amount: "10" });
    expect(r.status).toBe(200);
    expect(r.body.steps[0].command).toBe(`baw wallet resolve-domain --name ${r.body.recipient.agentName} --binanceChainId 56 --json`);
    expect(r.body.steps[2].template).toBe("baw wallet send --amount 10 --recipient <resolved address> --binanceChainId 56 --tokenAddress 0x55d398326f99059fF775485246999027B3197955 --json");
    expect(r.body.warnings.addressBook).toMatch(/Address Book/);
    expect(r.body.steps[2].note).toMatch(/broadcast, not confirmed/);
    // resolve still works inside the send flow (so the sender can compare addresses)
    expect((await X.post("/pay/recipient", { recipientUserId: yid })).body.address).toBe(Y.address);
  });
});
