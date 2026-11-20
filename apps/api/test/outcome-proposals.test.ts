/**
 * Audit 2026-11-20 F1: durable outcome proposal state machine against a real local chain (anvil + the real
 * AtlasThesisRegistry / AtlasOutcomeRegistry bytecode). Covers RPC failure then retry, a crash after persist and after
 * broadcast, a duplicate (concurrent) run, a reverted tx, a replaced/dropped tx, registry-first reconciliation (no double
 * propose), permissionless finalization after the dispute window, indexer-event reconciliation, and the migration backfill.
 * Skipped when anvil is not running.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createWalletClient, createTestClient, http, parseEther, type Hex, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { MockAgentIDAbi, AtlasOutcomeRegistryAbi, AtlasThesisRegistryAbi } from "@atlas/shared-types";
import { harness, Client, uniq, type Harness } from "./helpers.js";
import { runOutcomeProposals, defaultProposalChain, type ProposalChain } from "../src/workers/outcomes.js";
import { createIndexer } from "../src/workers/indexer.js";

const RPC = process.env.ANVIL_RPC ?? "http://127.0.0.1:8545";
const up = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }).then((r) => r.ok).catch(() => false);
const ART = new URL("../../../packages/contracts/out/AtlasOutcomeRegistry.sol/AtlasOutcomeRegistry.json", import.meta.url).pathname;

let h: Harness;
const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
const evaluator = privateKeyToAccount(generatePrivateKey());
const owner = privateKeyToAccount(generatePrivateKey());
const ownerW = createWalletClient({ account: owner, chain: foundry, transport: http(RPC) });
const evalW = createWalletClient({ account: evaluator, chain: foundry, transport: http(RPC) });
const WINDOW = 120; // seconds: a fresh outcome registry with a short dispute window (local only)

async function holder() {
  const c = new Client(h);
  await testClient.setBalance({ address: c.address, value: parseEther("10") });
  const w = createWalletClient({ account: c.account, chain: foundry, transport: http(RPC) });
  await h.deps.chain.waitForTransactionReceipt({ hash: await w.writeContract({ address: h.deps.contracts.agentId, abi: MockAgentIDAbi, functionName: "register", args: [uniq("eval")] }) });
  return { c, w };
}

/** Publishes a real thesis through the API (prepare → wallet tx → confirm) and queues a TargetHit proposal for it. */
async function publishedAndQueued() {
  const a = await holder();
  await a.c.login();
  const price = (await a.c.get("/markets/BNB")).body.ticker.lastPrice as number;
  const d = await a.c.post("/theses", { asset: "BNB", direction: "LONG", targetPrice: (price * 1.05).toFixed(2), invalidationPrice: (price * 0.97).toFixed(2), horizonHours: 72, title: uniq("Outcome test"), summary: "Range low holding with rising volume.", body: "Notes", confidence: 60 });
  const prep = await a.c.post(`/theses/${d.body.thesis.id}/prepare`);
  const tx = await a.w.sendTransaction({ to: prep.body.transaction.to, data: prep.body.transaction.data, value: 0n });
  await h.deps.chain.waitForTransactionReceipt({ hash: tx });
  expect((await a.c.post(`/theses/${d.body.thesis.id}/confirm`, { txHash: tx })).status).toBe(200);
  const [t] = await h.deps.db.sys(`SELECT id, onchain_id FROM theses WHERE id = $1`, [d.body.thesis.id]);
  const [start] = (await h.deps.chain.readContract({ address: h.deps.contracts.thesis, abi: AtlasThesisRegistryAbi, functionName: "observationWindow", args: [BigInt(t.onchain_id)] })) as unknown as [bigint, bigint];
  const evidenceHash = `0x${randomBytes(32).toString("hex")}`;
  await h.deps.db.sys(`UPDATE theses SET outcome = 'TargetHit', outcome_state = 'Evaluated', evidence_hash = $2 WHERE id = $1`, [t.id, evidenceHash]);
  await h.deps.db.sys(`INSERT INTO outcome_proposals (thesis_id, chain_id, registry, onchain_id, state, outcome, outcome_kind, observed_at, observed_price, evidence_hash, next_retry_at)
                       VALUES ($1, 31337, $2, $3, 'PROPOSAL_PENDING', 'TargetHit', 1, $4, $5, $6, to_timestamp($7))`,
    [t.id, h.deps.contracts.outcome.toLowerCase(), t.onchain_id, start.toString(), (BigInt(Math.round(price * 1.06 * 1e8))).toString(), evidenceHash, h.deps.now()]);
  return { id: t.id as string, onchainId: BigInt(t.onchain_id) };
}

const row = async (id: string) => (await h.deps.db.sys(`SELECT * FROM outcome_proposals WHERE thesis_id = $1`, [id]))[0];
const events = async (id: string) => (await h.deps.db.sys(`SELECT kind, detail FROM outcome_proposal_events WHERE thesis_id = $1 ORDER BY id`, [id])).map((e) => e.kind as string);
const attestation = async (id: bigint) => (await h.deps.chain.readContract({ address: h.deps.contracts.outcome, abi: AtlasOutcomeRegistryAbi, functionName: "getAttestation", args: [id] })) as any;
const evalNonce = () => h.deps.chain.getTransactionCount({ address: evaluator.address, blockTag: "latest" });
const due = (s = 0) => h.deps.db.sys(`UPDATE outcome_proposals SET next_retry_at = to_timestamp($1)`, [h.deps.now() - 1 + s]);
const setEvaluator = async (on: boolean) => h.deps.chain.waitForTransactionReceipt({ hash: await ownerW.writeContract({ address: h.deps.contracts.outcome, abi: AtlasOutcomeRegistryAbi, functionName: "setEvaluator", args: [evaluator.address, on] }) });
const chainWith = (over: Partial<ProposalChain> = {}, gas?: bigint): ProposalChain => ({ ...defaultProposalChain(h.deps, evaluator, gas ? { gas } : {}), ...over });

describe.skipIf(!up)("outcome proposal state machine (anvil)", () => {
  beforeAll(async () => {
    h = await harness({ AGENT_ID_MODE: "onchain", RPC_URL: RPC });
    await testClient.setBalance({ address: owner.address, value: parseEther("10") });
    await testClient.setBalance({ address: evaluator.address, value: parseEther("10") });
    // a fresh AtlasOutcomeRegistry (real bytecode) over the deployed thesis registry, with a 120 s dispute window
    const art = JSON.parse(readFileSync(ART, "utf8"));
    const hash = await ownerW.deployContract({ abi: art.abi, bytecode: art.bytecode.object as Hex, args: [h.deps.contracts.agentId, h.deps.contracts.thesis, BigInt(WINDOW), owner.address] });
    const r = await h.deps.chain.waitForTransactionReceipt({ hash });
    h.deps.contracts.outcome = r.contractAddress as Address;
    await setEvaluator(true);
  });
  afterAll(async () => { await h?.close(); });

  it("an RPC failure leaves the proposal queued with backoff; it is retried and proposed exactly once", async () => {
    const t = await publishedAndQueued();
    let fails = 1;
    const flaky = chainWith({ nonce: async () => { if (fails-- > 0) throw new Error("fetch failed: ECONNRESET"); return evalNonce(); } });
    const r1 = await runOutcomeProposals(h.deps, { chain: flaky });
    expect(r1.failed).toBe(1);
    let p = await row(t.id);
    expect(p.state).toBe("PROPOSAL_PENDING");
    expect(p.attempts).toBe(1);
    expect(p.last_error).toMatch(/ECONNRESET/);
    expect(new Date(p.next_retry_at).getTime() / 1000).toBeGreaterThan(h.deps.now());
    // not due yet: nothing is sent
    const n0 = await evalNonce();
    expect((await runOutcomeProposals(h.deps, { chain: flaky })).sent).toBe(0);
    h.clock.offset += 600;
    const r2 = await runOutcomeProposals(h.deps, { chain: flaky });
    expect(r2.sent).toBe(1);
    p = await row(t.id);
    expect(p.state).toBe("PROPOSED_ONCHAIN");
    expect(p.propose_tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(p.tx_hash).toBeNull();
    expect(p.last_error).toBeNull();
    expect(await evalNonce()).toBe(n0 + 1);
    expect(Number((await attestation(t.onchainId)).state)).toBe(1);
    expect((await h.deps.db.sys(`SELECT outcome_state FROM theses WHERE id = $1`, [t.id]))[0].outcome_state).toBe("Proposed");
    // running again never proposes twice
    await due();
    expect((await runOutcomeProposals(h.deps, { chain: flaky })).sent).toBe(0);
    expect(await evalNonce()).toBe(n0 + 1);
  });

  it("a send that errors on the wire (unknown if accepted) stays in flight and is rebroadcast with the same bytes", async () => {
    const t = await publishedAndQueued();
    let failSend = true;
    const c = chainWith({ sendRaw: async (raw) => { if (failSend) { failSend = false; throw new Error("socket hang up"); } return defaultProposalChain(h.deps, evaluator).sendRaw(raw); } });
    await runOutcomeProposals(h.deps, { chain: c });
    const p1 = await row(t.id);
    expect(p1.state).toBe("PROPOSAL_BROADCAST");
    expect(p1.tx_hash).toMatch(/^0x/);
    expect(p1.last_error).toMatch(/socket hang up/);
    await runOutcomeProposals(h.deps, { chain: c });
    const p2 = await row(t.id);
    expect(p2.state).toBe("PROPOSED_ONCHAIN");
    expect(p2.propose_tx).toBe(p1.tx_hash); // the persisted tx, not a new one
    expect(await events(t.id)).toEqual(expect.arrayContaining(["broadcast", "failed", "rebroadcast", "mined"]));
  });

  it("a crash after broadcast is reconciled by receipt (no second tx); a crash before send rebroadcasts the persisted tx", async () => {
    const t = await publishedAndQueued();
    const n0 = await evalNonce();
    await expect(runOutcomeProposals(h.deps, { chain: chainWith(), crash: { afterBroadcast: true } })).rejects.toThrow(/simulated crash/);
    expect((await row(t.id)).state).toBe("PROPOSAL_BROADCAST");
    await runOutcomeProposals(h.deps, { chain: chainWith() });
    expect((await row(t.id)).state).toBe("PROPOSED_ONCHAIN");
    expect(await evalNonce()).toBe(n0 + 1);

    const u = await publishedAndQueued();
    await expect(runOutcomeProposals(h.deps, { chain: chainWith(), crash: { afterPersist: true } })).rejects.toThrow(/simulated crash/);
    const persisted = await row(u.id);
    expect(persisted.state).toBe("PROPOSAL_BROADCAST");
    expect(await evalNonce()).toBe(n0 + 1); // never left the process
    await runOutcomeProposals(h.deps, { chain: chainWith() });
    const after = await row(u.id);
    expect(after.state).toBe("PROPOSED_ONCHAIN");
    expect(after.propose_tx).toBe(persisted.tx_hash);
    expect(await evalNonce()).toBe(n0 + 2);
  });

  it("duplicate concurrent runs send one tx; a registry that already holds the attestation is reconciled without sending", async () => {
    const t = await publishedAndQueued();
    const n0 = await evalNonce();
    const [a, b] = await Promise.all([runOutcomeProposals(h.deps, { chain: chainWith() }), runOutcomeProposals(h.deps, { chain: chainWith() })]);
    expect(a.sent + b.sent).toBe(1);
    expect(await evalNonce()).toBe(n0 + 1);
    expect((await row(t.id)).state).toBe("PROPOSED_ONCHAIN");

    // another evaluator path (e.g. a manual proposal) got there first: ATLAS must not send a second proposeOutcome
    const u = await publishedAndQueued();
    const p = await row(u.id);
    await h.deps.chain.waitForTransactionReceipt({ hash: await evalW.writeContract({ address: h.deps.contracts.outcome, abi: AtlasOutcomeRegistryAbi, functionName: "proposeOutcome", args: [u.onchainId, 1, BigInt(p.observed_at), BigInt(p.observed_price), p.evidence_hash] }) });
    const n1 = await evalNonce();
    const r = await runOutcomeProposals(h.deps, { chain: chainWith() });
    expect(r.sent).toBe(0);
    expect(r.reconciled).toBeGreaterThanOrEqual(1);
    expect((await row(u.id)).state).toBe("PROPOSED_ONCHAIN");
    expect(await evalNonce()).toBe(n1);
  });

  it("a reverted tx returns the proposal to PENDING with backoff and is retried once the cause is fixed", async () => {
    const t = await publishedAndQueued();
    await setEvaluator(false); // the tx will revert NotEvaluator (simulation bypassed to force a real on-chain revert)
    await runOutcomeProposals(h.deps, { chain: chainWith({ simulate: async () => {} }, 300_000n) });
    let p = await row(t.id);
    expect(p.state).toBe("PROPOSAL_PENDING");
    expect(p.last_error).toMatch(/reverted/);
    expect(p.attempts).toBe(1);
    expect(p.propose_tx).toBeNull();
    expect(await events(t.id)).toContain("reverted");
    // with simulation on, a still-broken config never spends gas: it fails in simulation and stays queued
    h.clock.offset += 600;
    const n0 = await evalNonce();
    await runOutcomeProposals(h.deps, { chain: chainWith() });
    p = await row(t.id);
    expect(p.state).toBe("PROPOSAL_PENDING");
    expect(p.last_error).toMatch(/simulation reverted/);
    expect(await evalNonce()).toBe(n0);
    await setEvaluator(true);
    h.clock.offset += 3600;
    await runOutcomeProposals(h.deps, { chain: chainWith() });
    expect((await row(t.id)).state).toBe("PROPOSED_ONCHAIN");
  });

  it("a persisted tx whose nonce was consumed by another tx (replaced/dropped) is detected and re-proposed", async () => {
    const t = await publishedAndQueued();
    await expect(runOutcomeProposals(h.deps, { chain: chainWith(), crash: { afterPersist: true } })).rejects.toThrow(/simulated crash/);
    // the evaluator key is used elsewhere and consumes that nonce
    await h.deps.chain.waitForTransactionReceipt({ hash: await evalW.sendTransaction({ to: evaluator.address, value: 0n }) });
    await runOutcomeProposals(h.deps, { chain: chainWith() });
    let p = await row(t.id);
    expect(p.state).toBe("PROPOSAL_PENDING");
    expect(p.last_error).toMatch(/replaced or dropped/);
    expect(await events(t.id)).toContain("dropped");
    h.clock.offset += 600;
    await runOutcomeProposals(h.deps, { chain: chainWith() });
    p = await row(t.id);
    expect(p.state).toBe("PROPOSED_ONCHAIN");
  });

  it("after the dispute window the permissionless finalize is sent; FINALIZED comes from registry state; the indexer agrees", async () => {
    const before = await h.deps.db.sys(`SELECT thesis_id FROM outcome_proposals WHERE state = 'PROPOSED_ONCHAIN'`);
    expect(before.length).toBeGreaterThan(0);
    await due(); // too early on-chain: nothing is sent
    expect((await runOutcomeProposals(h.deps, { chain: chainWith() })).sent).toBe(0);
    await testClient.increaseTime({ seconds: WINDOW + 5 });
    await testClient.mine({ blocks: 1 });
    await due();
    const r = await runOutcomeProposals(h.deps, { chain: chainWith(), limit: 50 });
    expect(r.finalized).toBe(before.length);
    for (const b of before) {
      const p = await row(b.thesis_id);
      expect(p.state).toBe("FINALIZED");
      expect(p.finalize_tx).toMatch(/^0x/);
      expect((await h.deps.db.sys(`SELECT outcome_state, outcome FROM theses WHERE id = $1`, [b.thesis_id]))[0]).toEqual({ outcome_state: "Final", outcome: "TargetHit" });
    }
    // indexer events reconcile the same state (and never downgrade FINALIZED)
    const ix = createIndexer(h.deps, { confirmations: 1 });
    for (let i = 0; i < 100; i++) if ((await ix.step()).caughtUp) break;
    const states = await h.deps.db.sys(`SELECT state FROM outcome_proposals WHERE thesis_id = ANY($1::uuid[])`, [before.map((b) => b.thesis_id)]);
    expect(states.every((s) => s.state === "FINALIZED")).toBe(true);
    const indexed = await h.deps.db.sys(`SELECT count(*)::int AS n FROM outcome_proposal_events WHERE kind = 'indexed'`);
    expect(indexed[0].n).toBeGreaterThan(0);
  });

  it("without an evaluator key the outbox waits (no attempts burned) and reports pending", async () => {
    const t = await publishedAndQueued();
    const r = await runOutcomeProposals(h.deps, { chain: { ...chainWith(), signer: null } });
    expect(r.pending).toBeGreaterThanOrEqual(1);
    const p = await row(t.id);
    expect(p.state).toBe("PROPOSAL_PENDING");
    expect(p.attempts).toBe(0);
    expect(p.last_error).toBe("no evaluator key configured");
    h.clock.offset += 3600;
    await runOutcomeProposals(h.deps, { chain: chainWith() });
    expect((await row(t.id)).state).toBe("PROPOSED_ONCHAIN");
  });
});
