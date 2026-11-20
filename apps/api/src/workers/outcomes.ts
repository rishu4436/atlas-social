import { encodeFunctionData, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { prepareTransactionRequest, sendRawTransaction } from "viem/actions";
import { evaluateWithSources } from "@atlas/outcome-engine";
import { AtlasOutcomeRegistryAbi, OutcomeKind, toPrice8 } from "@atlas/shared-types";
import type { MarketDataProvider } from "@atlas/market-data";
import type { Deps } from "../deps.js";
import { termsFromJson, OUTCOME_NAMES } from "../lib/theses.js";
import { acquireLease, releaseLease, logAlert, type AlertFn } from "./runs.js";

/**
 * Outcome evaluation + durable on-chain proposal (audit 2026-11-20 F1).
 *
 * evaluateOpenTheses() scores published theses using only the REAL price sources their committed methodology allows
 * (ATLAS-M1: Binance; ATLAS-M1.1: Binance then OKX). A resolved thesis gets its evaluated outcome AND an
 * outcome_proposals row in the same transaction (the outbox), so a failed or crashed proposal can never be lost.
 *
 * runOutcomeProposals() drains the outbox under a DB lease (one runner => one evaluator nonce stream):
 *   1. every row with an in-flight tx is reconciled first (receipt, then registry state); a tx whose nonce is unused and
 *      that the node no longer knows is rebroadcast from the persisted raw bytes (same hash => idempotent);
 *   2. only when nothing is in flight does it send ONE new tx at a time, re-reading the registry first (no double propose:
 *      if the attestation is already Proposed/Final, the row is reconciled without sending);
 *   3. the signed tx (hash, nonce, raw) is persisted BEFORE broadcast, so a crash after broadcast is reconciled by receipt;
 *   4. failures (RPC errors, reverts) go back to PROPOSAL_PENDING with exponential backoff; they stay eligible forever;
 *   5. after the dispute window, the permissionless finalizeOutcome is sent; FINALIZED is only ever set from registry
 *      state (worker) or an OutcomeFinalized event (indexer).
 */

// ------------------------------------------------------------------------------------------ evaluation
export async function evaluateOpenTheses(deps: Deps, opts: { sources?: MarketDataProvider[]; log?: (m: string) => void } = {}) {
  const sources = opts.sources ?? deps.priceSources;
  const log = opts.log ?? (() => {});
  const rows = await deps.db.sys(`SELECT * FROM theses WHERE chain_status = 'published' AND outcome = 'Open' AND start_time IS NOT NULL ORDER BY start_time LIMIT 50`);
  let resolved = 0;
  for (const t of rows) {
    try {
      const ev = await evaluateWithSources(sources, { terms: termsFromJson(t.terms), startTime: Math.floor(new Date(t.start_time).getTime() / 1000), symbol: t.symbol, now: deps.now() });
      await deps.db.sys(`UPDATE theses SET scoring_status = $2, scoring_source = $3, scoring_note = $4, scoring_checked_at = now() WHERE id = $1`,
        [t.id, ev.scorable ? (ev.status === "RESOLVED" ? "scored" : "pending") : "unscorable", ev.scorable ? ev.evidence.source : null, ev.reason]);
      if (ev.status !== "RESOLVED") continue;
      const proposable = ev.scorable && ev.outcome !== OutcomeKind.None && t.onchain_id != null;
      const observedPrice = ev.exitPrice ? toPrice8(ev.exitPrice.toFixed(8)).toString() : "0";
      const observedAt = ev.observedAt ?? null;
      const done = await deps.db.sysTx(async (q) => {
        const u = await q(`UPDATE theses SET outcome = $2, return_bps = $3, evidence = $4, evidence_hash = $5, resolved_at = now(), outcome_state = coalesce(outcome_state, 'Evaluated') WHERE id = $1 AND outcome = 'Open' RETURNING id`,
          [t.id, OUTCOME_NAMES[ev.outcome], ev.returnBps, ev.evidence, ev.evidenceHash]);
        if (!u.length) return false;
        await q(`INSERT INTO outcome_proposals (thesis_id, chain_id, registry, onchain_id, state, outcome, outcome_kind, observed_at, observed_price, evidence, evidence_hash, note, next_retry_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,to_timestamp($13)) ON CONFLICT (thesis_id) DO NOTHING`,
          [t.id, deps.contracts.chainId, deps.contracts.outcome.toLowerCase(), t.onchain_id ?? 0, proposable ? "PROPOSAL_PENDING" : "EVALUATED", OUTCOME_NAMES[ev.outcome], ev.outcome,
            observedAt, observedPrice, ev.evidence, ev.evidenceHash, proposable ? null : `not proposed: ${ev.scorable ? "nothing to propose" : "unscorable (" + (ev.reason ?? "no allowed real price source") + ")"}`, deps.now()]);
        await q(`INSERT INTO outcome_proposal_events (thesis_id, kind, detail) VALUES ($1,'evaluated',$2)`, [t.id, { outcome: OUTCOME_NAMES[ev.outcome], evidenceHash: ev.evidenceHash, queued: proposable }]);
        return true;
      });
      if (done) resolved++;
    } catch (e) {
      log(`evaluation failed for ${t.id}: ${(e as Error).message}`);
    }
  }
  return { checked: rows.length, resolved };
}

// ------------------------------------------------------------------------------------------ chain adapter
export const REG_STATE = ["None", "Proposed", "Challenged", "Final"] as const;
export interface Attestation { state: number; outcome: number; round: number; proposedAt: bigint; evaluator: Address }
export type TxKind = "propose" | "finalize";
export interface TxArgs { kind: TxKind; thesisId: bigint; outcome?: number; observedAt?: bigint; observedPrice?: bigint; evidenceHash?: Hex }

/** Everything the proposal worker needs from the chain. Tests wrap the default implementation to inject faults. */
export interface ProposalChain {
  signer: Address | null;
  readAttestation(thesisId: bigint): Promise<Attestation>;
  disputeWindow(): Promise<bigint>;
  blockTime(): Promise<bigint>;
  receipt(hash: Hex): Promise<{ status: "success" | "reverted"; blockNumber: bigint } | null>;
  txKnown(hash: Hex): Promise<boolean>;
  nonce(): Promise<number>;
  /** Throws (with the revert reason) if the call would revert. */
  simulate(a: TxArgs): Promise<void>;
  sign(a: TxArgs, nonce: number): Promise<{ hash: Hex; raw: Hex }>;
  sendRaw(raw: Hex): Promise<Hex>;
  waitReceipt(hash: Hex, timeoutMs: number): Promise<{ status: "success" | "reverted"; blockNumber: bigint } | null>;
  balance(): Promise<bigint | null>;
}

const callData = (a: TxArgs) => a.kind === "propose"
  ? encodeFunctionData({ abi: AtlasOutcomeRegistryAbi, functionName: "proposeOutcome", args: [a.thesisId, a.outcome!, a.observedAt!, a.observedPrice!, a.evidenceHash!] as any })
  : encodeFunctionData({ abi: AtlasOutcomeRegistryAbi, functionName: "finalizeOutcome", args: [a.thesisId] as any });

export function evaluatorAccount(): PrivateKeyAccount | null {
  const key = process.env.EVALUATOR_PRIVATE_KEY as Hex | undefined;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return privateKeyToAccount(key);
}

export function defaultProposalChain(deps: Deps, account: PrivateKeyAccount | null = evaluatorAccount(), o: { gas?: bigint } = {}): ProposalChain {
  const client = deps.chain as PublicClient;
  const reg = deps.contracts.outcome;
  const notFound = (e: unknown) => /not (be )?found|could not be found/i.test((e as Error).message ?? "");
  const receipt = async (hash: Hex) => {
    try {
      const r = await client.getTransactionReceipt({ hash });
      return { status: r.status, blockNumber: r.blockNumber };
    } catch (e) { if (notFound(e)) return null; throw e; }
  };
  return {
    signer: account?.address ?? null,
    async readAttestation(id) {
      const a: any = await client.readContract({ address: reg, abi: AtlasOutcomeRegistryAbi, functionName: "getAttestation", args: [id] as any });
      return { state: Number(a.state), outcome: Number(a.outcome), round: Number(a.round), proposedAt: BigInt(a.proposedAt), evaluator: a.evaluator };
    },
    async disputeWindow() { return BigInt(await client.readContract({ address: reg, abi: AtlasOutcomeRegistryAbi, functionName: "disputeWindow" }) as any); },
    async blockTime() { return (await client.getBlock({ blockTag: "latest" })).timestamp; },
    receipt,
    async txKnown(hash) {
      try { await client.getTransaction({ hash }); return true; } catch (e) { if (notFound(e)) return false; throw e; }
    },
    async nonce() { return client.getTransactionCount({ address: account!.address, blockTag: "latest" }); },
    async simulate(a) {
      await client.call({ account: account!.address, to: reg, data: callData(a) });
    },
    async sign(a, nonce) {
      const req: any = await prepareTransactionRequest(client, { account: account!, chain: client.chain, to: reg, data: callData(a), nonce, value: 0n, ...(o.gas ? { gas: o.gas } : {}) } as any);
      const { account: _a, from: _f, parameters: _p, chainId, ...tx } = req;
      const raw = await account!.signTransaction({ ...tx, chainId: chainId ?? client.chain!.id });
      return { hash: keccak256(raw), raw };
    },
    async sendRaw(raw) { return sendRawTransaction(client, { serializedTransaction: raw }); },
    async waitReceipt(hash, timeoutMs) {
      try {
        const r = await client.waitForTransactionReceipt({ hash, timeout: timeoutMs, pollingInterval: Math.min(2000, Math.max(100, timeoutMs / 10)) });
        return { status: r.status, blockNumber: r.blockNumber };
      } catch { return receipt(hash).catch(() => null); }
    },
    async balance() { return account ? client.getBalance({ address: account.address }).catch(() => null) : null; },
  };
}

// ------------------------------------------------------------------------------------------ proposal worker
export const PROPOSAL_LEASE = "outcome-proposals";
const MAX_BACKOFF_S = 6 * 3600;
export const backoffSeconds = (attempts: number) => Math.min(MAX_BACKOFF_S, 60 * 2 ** Math.max(0, attempts - 1));
const short = (e: unknown) => ((e as any)?.shortMessage ?? (e as Error)?.message ?? String(e)).split("\n")[0]!.slice(0, 300);

export interface ProposalRunOpts {
  chain?: ProposalChain;
  log?: (m: string) => void;
  alert?: AlertFn;
  receiptTimeoutMs?: number;
  /** Rebroadcast a persisted tx the node no longer knows after this long (seconds). */
  rebroadcastAfterS?: number;
  autoFinalize?: boolean;
  limit?: number;
  /** Test hooks: simulate a process crash at these points. */
  crash?: { afterPersist?: boolean; afterBroadcast?: boolean };
}

export interface ProposalRunResult { ran: boolean; reconciled: number; sent: number; failed: number; finalized: number; pending: number }

export async function runOutcomeProposals(deps: Deps, opts: ProposalRunOpts = {}): Promise<ProposalRunResult> {
  const res: ProposalRunResult = { ran: false, reconciled: 0, sent: 0, failed: 0, finalized: 0, pending: 0 };
  if (!deps.contracts.atlasDeployed) return res;
  const owner = await acquireLease(deps, PROPOSAL_LEASE, 300);
  if (!owner) return res; // another runner holds the lease: duplicate run is a no-op
  res.ran = true;
  const chain = opts.chain ?? defaultProposalChain(deps);
  const log = opts.log ?? (() => {});
  const alert = opts.alert ?? logAlert;
  const reg = deps.contracts.outcome.toLowerCase();
  const now = () => deps.now();
  const ev = (q: (s: string, p?: unknown[]) => Promise<any[]>, id: string, kind: string, detail: Record<string, unknown> = {}) =>
    q(`INSERT INTO outcome_proposal_events (thesis_id, kind, detail) VALUES ($1,$2,$3)`, [id, kind, JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v))]);
  const sys = deps.db.sys;

  /** Moves a row to the state the registry reports (the source of truth). Returns true if it moved. */
  const syncFromRegistry = async (row: any, a: Attestation, why: string) => {
    const st = REG_STATE[a.state];
    if (st === "None") return false;
    const state = st === "Final" ? "FINALIZED" : st === "Challenged" ? "CHALLENGED" : "PROPOSED_ONCHAIN";
    const window = st === "Proposed" ? await chain.disputeWindow() : 0n;
    const due = st === "Proposed" ? Number(a.proposedAt + window) + 60 : now() + 3600;
    await sys(`UPDATE outcome_proposals SET state = $2, onchain_outcome = $3, onchain_round = $4, proposed_at = $5, registry = $6, next_retry_at = to_timestamp($7), updated_at = now(),
                 note = CASE WHEN $2 = 'CHALLENGED' THEN 'challenged on-chain: re-proposal needs human review' ELSE note END WHERE thesis_id = $1`,
      [row.thesis_id, state, OUTCOME_NAMES[a.outcome], a.round, a.proposedAt.toString(), reg, due]);
    await sys(`UPDATE theses SET outcome_state = $2, outcome = CASE WHEN $2 = 'Final' THEN $3 ELSE outcome END WHERE id = $1`, [row.thesis_id, st, OUTCOME_NAMES[a.outcome]]);
    await ev(sys, row.thesis_id, state === "FINALIZED" ? "finalized" : state === "CHALLENGED" ? "challenged" : "reconciled", { registryState: st, round: a.round, why });
    if (state === "FINALIZED") res.finalized++;
    if (state === "CHALLENGED") alert("outcome challenged on-chain; needs human review", { thesisId: row.thesis_id, onchainId: String(row.onchain_id) });
    return true;
  };

  const fail = async (row: any, err: string, kind = "failed", clearTx = true) => {
    const attempts = Number(row.attempts) + (clearTx ? 0 : 1);
    const next = now() + backoffSeconds(Math.max(1, attempts));
    await sys(`UPDATE outcome_proposals SET state = CASE WHEN tx_kind = 'finalize' OR state = 'PROPOSED_ONCHAIN' THEN 'PROPOSED_ONCHAIN' ELSE 'PROPOSAL_PENDING' END,
               last_error = $2, attempts = $3, next_retry_at = to_timestamp($4), updated_at = now()
               ${clearTx ? ", tx_kind = NULL, tx_hash = NULL, tx_nonce = NULL, tx_raw = NULL, tx_from = NULL, broadcast_at = NULL" : ""} WHERE thesis_id = $1`,
      [row.thesis_id, err, attempts, next]);
    await ev(sys, row.thesis_id, kind, { error: err, attempts, retryAt: new Date(next * 1000).toISOString() });
    res.failed++;
    if (attempts >= 5) alert("outcome proposal keeps failing", { thesisId: row.thesis_id, attempts, error: err });
  };

  /** Settles an in-flight tx row. Returns true while the tx is still pending (=> nothing new may be sent). */
  const reconcileInflight = async (row: any): Promise<boolean> => {
    const hash = row.tx_hash as Hex;
    const r = await chain.receipt(hash);
    if (r) {
      await sys(`UPDATE outcome_proposals SET ${row.tx_kind === "finalize" ? "finalize_tx" : "propose_tx"} = CASE WHEN $3 = 'success' THEN $2 ELSE ${row.tx_kind === "finalize" ? "finalize_tx" : "propose_tx"} END,
                   tx_kind = NULL, tx_hash = NULL, tx_nonce = NULL, tx_raw = NULL, tx_from = NULL, broadcast_at = NULL, updated_at = now() WHERE thesis_id = $1`, [row.thesis_id, hash, r.status]);
      await ev(sys, row.thesis_id, r.status === "success" ? "mined" : "reverted", { tx: hash, kind: row.tx_kind, block: r.blockNumber });
      const a = await chain.readAttestation(BigInt(row.onchain_id));
      await syncFromRegistry({ ...row }, a, `receipt ${r.status}`);
      const st = REG_STATE[a.state];
      const intentMet = row.tx_kind === "finalize" ? st === "Final" : st !== "None";
      if (!intentMet) await fail({ ...row }, r.status === "reverted" ? `tx ${hash} reverted` : `tx ${hash} mined but the registry shows ${st}`, r.status === "reverted" ? "reverted" : "failed");
      else await sys(`UPDATE outcome_proposals SET last_error = NULL WHERE thesis_id = $1`, [row.thesis_id]);
      res.reconciled++;
      return false;
    }
    // no receipt: pending, dropped, replaced, or never left this process (crash between persist and send)
    if (await chain.txKnown(hash)) return true;
    const nonce = await chain.nonce();
    if (nonce > Number(row.tx_nonce)) {
      // our nonce was consumed by a different tx (replacement) and ours never mined
      await ev(sys, row.thesis_id, "dropped", { tx: hash, nonce: row.tx_nonce, accountNonce: nonce });
      const a = await chain.readAttestation(BigInt(row.onchain_id));
      if (!(await syncFromRegistry(row, a, "nonce consumed by another tx"))) await fail(row, `tx ${hash} was replaced or dropped (nonce ${row.tx_nonce} consumed)`, "dropped");
      else await sys(`UPDATE outcome_proposals SET tx_kind = NULL, tx_hash = NULL, tx_nonce = NULL, tx_raw = NULL, tx_from = NULL, broadcast_at = NULL WHERE thesis_id = $1`, [row.thesis_id]);
      res.reconciled++;
      return false;
    }
    // nonce unused and the node does not know the tx: rebroadcast the exact persisted bytes (same hash, idempotent)
    const age = now() - Math.floor(new Date(row.broadcast_at).getTime() / 1000);
    if (row.tx_raw && (age >= (opts.rebroadcastAfterS ?? 0) || row.last_error)) {
      try {
        await chain.sendRaw(row.tx_raw as Hex);
        await ev(sys, row.thesis_id, "rebroadcast", { tx: hash, nonce: row.tx_nonce });
        await sys(`UPDATE outcome_proposals SET last_error = NULL, broadcast_at = now(), updated_at = now() WHERE thesis_id = $1`, [row.thesis_id]);
      } catch (e) {
        await sys(`UPDATE outcome_proposals SET last_error = $2, updated_at = now() WHERE thesis_id = $1`, [row.thesis_id, `rebroadcast failed: ${short(e)}`]);
        await ev(sys, row.thesis_id, "failed", { tx: hash, error: short(e), rebroadcast: true });
        return true;
      }
      const w = await chain.waitReceipt(hash, opts.receiptTimeoutMs ?? 30_000);
      if (w) return reconcileInflight({ ...row });
    }
    return true;
  };

  try {
    // 1) in-flight transactions first
    const inflight = await sys(`SELECT * FROM outcome_proposals WHERE tx_hash IS NOT NULL AND chain_id = $1 ORDER BY tx_nonce`, [deps.contracts.chainId]);
    let blocked = false;
    for (const row of inflight) {
      try { if (await reconcileInflight(row)) blocked = true; } catch (e) { blocked = true; log(`reconcile failed for ${row.thesis_id}: ${short(e)}`); await sys(`UPDATE outcome_proposals SET last_error = $2 WHERE thesis_id = $1`, [row.thesis_id, `reconcile: ${short(e)}`]); }
    }
    // 2) due rows (registry read first: never propose what is already on-chain)
    const due = await sys(`SELECT * FROM outcome_proposals WHERE chain_id = $1 AND tx_hash IS NULL AND state IN ('PROPOSAL_PENDING','PROPOSED_ONCHAIN') AND next_retry_at <= to_timestamp($2)
                           ORDER BY next_retry_at LIMIT $3`, [deps.contracts.chainId, now(), opts.limit ?? 25]);
    for (const row of due) {
      try {
        const a = await chain.readAttestation(BigInt(row.onchain_id));
        const st = REG_STATE[a.state];
        if (row.state === "PROPOSAL_PENDING" && st !== "None") { await syncFromRegistry(row, a, "registry already holds an attestation"); res.reconciled++; continue; }
        if (row.state === "PROPOSED_ONCHAIN" && st !== "Proposed") { if (await syncFromRegistry(row, a, "registry moved")) res.reconciled++; continue; }
        if (!chain.signer) {
          await sys(`UPDATE outcome_proposals SET last_error = 'no evaluator key configured', next_retry_at = to_timestamp($2) WHERE thesis_id = $1`, [row.thesis_id, now() + 600]);
          res.pending++;
          continue;
        }
        let args: TxArgs;
        if (row.state === "PROPOSAL_PENDING") {
          args = { kind: "propose", thesisId: BigInt(row.onchain_id), outcome: Number(row.outcome_kind), observedAt: BigInt(row.observed_at ?? 0), observedPrice: BigInt(row.observed_price ?? 0), evidenceHash: row.evidence_hash };
        } else {
          if (opts.autoFinalize === false || process.env.OUTCOME_AUTO_FINALIZE === "false") continue;
          const [win, t] = await Promise.all([chain.disputeWindow(), chain.blockTime()]);
          if (t <= a.proposedAt + win) { await sys(`UPDATE outcome_proposals SET next_retry_at = to_timestamp($2) WHERE thesis_id = $1`, [row.thesis_id, Number(a.proposedAt + win) + 60]); continue; }
          args = { kind: "finalize", thesisId: BigInt(row.onchain_id) };
        }
        if (blocked) { res.pending++; continue; } // one in-flight tx per signer (nonce safety)
        try { await chain.simulate(args); } catch (e) { await fail({ ...row, attempts: row.attempts }, `simulation reverted: ${short(e)}`, "failed", false); continue; }
        const nonce = await chain.nonce();
        const { hash, raw } = await chain.sign(args, nonce);
        // persist BEFORE broadcast: a crash from here on is recovered by receipt / rebroadcast of the same bytes
        await sys(`UPDATE outcome_proposals SET state = CASE WHEN $2 = 'propose' THEN 'PROPOSAL_BROADCAST' ELSE state END, tx_kind = $2, tx_hash = $3, tx_nonce = $4, tx_raw = $5, tx_from = $6,
                     broadcast_at = now(), attempts = attempts + 1, registry = $7, updated_at = now() WHERE thesis_id = $1 AND tx_hash IS NULL`,
          [row.thesis_id, args.kind, hash, nonce, raw, chain.signer.toLowerCase(), reg]);
        await ev(sys, row.thesis_id, "broadcast", { tx: hash, nonce, kind: args.kind, from: chain.signer });
        if (opts.crash?.afterPersist) throw new Error("simulated crash after persist");
        let sendErr: string | null = null;
        try { await chain.sendRaw(raw); } catch (e) { sendErr = short(e); }
        if (opts.crash?.afterBroadcast) throw new Error("simulated crash after broadcast");
        const fresh = { ...row, tx_kind: args.kind, tx_hash: hash, tx_nonce: nonce, tx_raw: raw, attempts: Number(row.attempts) + 1, broadcast_at: new Date() };
        if (sendErr) {
          if (/insufficient funds/i.test(sendErr)) { await fail(fresh, `send failed: ${sendErr}`); alert("evaluator out of gas funds", { signer: chain.signer }); blocked = true; continue; }
          // unknown whether the node accepted it: keep it in flight; the next pass reconciles (receipt / rebroadcast / dropped)
          await sys(`UPDATE outcome_proposals SET last_error = $2, next_retry_at = to_timestamp($3) WHERE thesis_id = $1`, [row.thesis_id, `send failed: ${sendErr}`, now() + backoffSeconds(fresh.attempts)]);
          await ev(sys, row.thesis_id, "failed", { tx: hash, error: sendErr, stage: "broadcast" });
          res.failed++;
          blocked = true;
          continue;
        }
        res.sent++;
        const w = await chain.waitReceipt(hash, opts.receiptTimeoutMs ?? 30_000);
        if (w) await reconcileInflight(fresh); else blocked = true;
      } catch (e) {
        if (opts.crash && /simulated crash/.test((e as Error).message)) throw e;
        log(`proposal step failed for ${row.thesis_id}: ${short(e)}`);
        await fail({ ...row, attempts: row.attempts }, short(e), "failed", false).catch(() => {});
      }
    }
    const [p] = await sys(`SELECT count(*)::int AS n FROM outcome_proposals WHERE state IN ('PROPOSAL_PENDING','PROPOSAL_BROADCAST')`);
    res.pending = p.n;
    return res;
  } finally {
    await releaseLease(deps, PROPOSAL_LEASE, owner);
  }
}

/** Startup reconciliation + periodic cycle: evaluate, then drain the proposal outbox. */
export async function outcomeCycle(deps: Deps, opts: { log?: (m: string) => void; alert?: AlertFn } = {}) {
  const evaluated = await evaluateOpenTheses(deps, { log: opts.log });
  const proposals = await runOutcomeProposals(deps, { log: opts.log, alert: opts.alert });
  return { evaluated, proposals };
}
