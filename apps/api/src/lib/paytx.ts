/**
 * Audit 2026-11-20 F3/F4: payment tx lifecycle and single-settlement payment requests.
 *
 * - Every reported tx hash is checked against the step the sender reviewed and stored in payment_txs.
 * - Its stage is derived from the chain (indexed PaymentSent → receipt → mempool → nonce), never from the report.
 * - "paid" means FINALIZED only. A USDT approve is never a payment.
 * - A payment request is settled ONLY by its first final matching PaymentSent event. A broadcast or provisional
 *   matching tx puts a pending lock on the request, which blocks new prepares until it settles, fails or expires.
 */
import type { Hex } from "viem";
import { explorerTx } from "@atlas/shared-types";
import { deriveStage, stageView, isFailedStage, type PayStage, type PayStepKind } from "@atlas/auth/pay-status";
import type { Deps } from "../deps.js";
import type { Q } from "../db/index.js";
import { ApiError } from "./errors.js";

/** A broadcast-only lock expires after this (a dropped tx must not block the request forever). */
export const PENDING_LOCK_MINUTES = 30;
/** A provisionally indexed matching payment holds the lock until finality (or a reorg removes it). */
export const PROVISIONAL_LOCK_HOURS = 24;
/** An unknown hash is reported as dropped after this. */
export const DROP_AFTER_SECONDS = 600;

export const finalityDepth = (deps: Pick<Deps, "contracts">) => (deps.contracts.chainId === 31337 ? 1 : 15);
export const stepKindOf = (data: string | undefined, mode: "contract-call" | "fallback") =>
  (mode === "fallback" ? "transfer" : String(data ?? "").toLowerCase().startsWith("0x095ea7b3") ? "approve" : "pay") as PayStepKind;

/** Lock a request to one broadcast tx. Returns false when another live tx already holds it. */
export async function lockRequest(q: Q, requestId: string, txHash: string, until: "broadcast" | "provisional", nowSeconds: number) {
  const interval = until === "broadcast" ? `${PENDING_LOCK_MINUTES} minutes` : `${PROVISIONAL_LOCK_HOURS} hours`;
  const rows = await q(
    `UPDATE payment_requests SET pending_tx_hash = $2, pending_until = greatest(coalesce(CASE WHEN pending_tx_hash = $2 THEN pending_until END, to_timestamp($4)), to_timestamp($4) + $3::interval)
      WHERE id = $1 AND status = 'open' AND (pending_tx_hash IS NULL OR pending_until IS NULL OR pending_until < to_timestamp($4) OR pending_tx_hash = $2) RETURNING id`,
    [requestId, txHash.toLowerCase(), interval, nowSeconds],
  );
  return rows.length > 0;
}

export async function releaseLock(q: Q, txHash: string) {
  await q(`UPDATE payment_requests SET pending_tx_hash = NULL, pending_until = NULL WHERE pending_tx_hash = $1 AND status = 'open'`, [txHash.toLowerCase()]);
}

/**
 * Settle open requests by their FIRST final matching PaymentSent (block order, then log index). Idempotent; called
 * whenever events become final. Later matching payments stay receipts and are shown as duplicates.
 */
export async function settleRequests(q: Q, requestIds?: string[]) {
  return q(
    `UPDATE payment_requests q SET status = 'paid', paid_tx_hash = f.tx_hash, settled_event_id = f.event_id, pending_tx_hash = NULL, pending_until = NULL
       FROM (SELECT DISTINCT ON (i.request_id) i.request_id, x.tx_hash, x.event_id
               FROM payments x JOIN payment_intents i ON i.id = x.intent_id JOIN chain_events ce ON ce.id = x.event_id
              WHERE x.status = 'final' AND i.request_id IS NOT NULL ${requestIds ? "AND i.request_id = ANY($1::uuid[])" : ""}
              ORDER BY i.request_id, x.block_number, ce.log_index, x.event_id) f
      WHERE q.id = f.request_id AND q.status = 'open' AND q.settled_event_id IS NULL RETURNING q.id`,
    requestIds ? [requestIds] : [],
  );
}

export interface ReportTx { txHash: Hex; payIntentId: string | null; connectIntentId: string | null; step: number; stepKind: PayStepKind; senderId: string; fromWallet: string; nonce: number | bigint | null; via: "connect" | "browser" | "manual" }

/** Store a verified tx report (idempotent per hash) and take the request's pending lock for a pay step. */
export async function recordPayTx(deps: Deps, r: ReportTx) {
  const hash = r.txHash.toLowerCase();
  return deps.db.sysTx(async (q) => {
    const [prev] = await q(`SELECT * FROM payment_txs WHERE tx_hash = $1`, [hash]);
    if (prev && (prev.pay_intent_id !== r.payIntentId || prev.step !== r.step)) throw new ApiError(409, "TX_ALREADY_REPORTED", "That transaction was already reported for another payment or step.");
    if (!prev) {
      await q(`INSERT INTO payment_txs (tx_hash, chain_id, pay_intent_id, connect_intent_id, step, step_kind, sender_id, from_wallet, nonce, reported_via) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [hash, deps.contracts.chainId, r.payIntentId, r.connectIntentId, r.step, r.stepKind, r.senderId, r.fromWallet.toLowerCase(), r.nonce === null ? null : r.nonce.toString(), r.via]);
    }
    let lock: "held" | "contended" | null = null;
    if (r.stepKind === "pay" && r.payIntentId) {
      const [i] = await q(`SELECT request_id FROM payment_intents WHERE id = $1`, [r.payIntentId]);
      if (i?.request_id) lock = (await lockRequest(q, i.request_id, hash, "broadcast", deps.now())) ? "held" : "contended";
    }
    return { lock };
  });
}

/** Re-derive a reported tx's stage from the chain and persist it. Failed pay txs release their request lock. */
export async function refreshPayTx(deps: Deps, txHash: string) {
  const hash = txHash.toLowerCase() as Hex;
  const [row] = await deps.db.sys(`SELECT t.*, i.request_id FROM payment_txs t LEFT JOIN payment_intents i ON i.id = t.pay_intent_id WHERE t.tx_hash = $1`, [hash]);
  if (!row) return null;
  const kind = row.step_kind as PayStepKind;
  let stage = row.stage as PayStage;
  let blockNumber: bigint | null = row.block_number ? BigInt(row.block_number) : null;
  const terminal = stage === "finalized" || stage === "approval_mined" || isFailedStage(stage);
  if (!terminal) {
    const [ev] = kind === "pay" ? await deps.db.sys(`SELECT status, block_number FROM payments WHERE chain_id = $1 AND tx_hash = $2 ORDER BY status = 'final' DESC LIMIT 1`, [deps.contracts.chainId, hash]) : [];
    const receipt = ev ? null : await deps.chain.getTransactionReceipt({ hash }).catch(() => null);
    const known = ev || receipt ? true : !!(await deps.chain.getTransaction({ hash }).catch(() => null));
    let nonceConsumed = false;
    if (!ev && !receipt && !known && row.nonce !== null) {
      const latest = await deps.chain.getTransactionCount({ address: row.from_wallet, blockTag: "latest" }).catch(() => null);
      nonceConsumed = latest !== null && BigInt(latest) > BigInt(row.nonce);
    }
    let deepEnough = false;
    if (receipt && kind === "transfer") {
      const head = await deps.chain.getBlockNumber({ cacheTime: 0 }).catch(() => null);
      deepEnough = head !== null && receipt.blockNumber <= head - BigInt(finalityDepth(deps)); // same final line as the indexer
    }
    blockNumber = ev ? BigInt(ev.block_number) : receipt?.blockNumber ?? blockNumber;
    stage = deriveStage({ stepKind: kind, event: ev?.status ?? null, receipt: receipt ? receipt.status : null, known, nonceConsumed, deepEnough,
      ageSeconds: Math.max(0, deps.now() - Math.floor(new Date(row.reported_at).getTime() / 1000)) }, DROP_AFTER_SECONDS);
    if (stage !== row.stage || String(blockNumber ?? "") !== String(row.block_number ?? "")) {
      await deps.db.sysTx(async (q) => {
        await q(`UPDATE payment_txs SET stage = $2, block_number = $3, updated_at = now() WHERE tx_hash = $1`, [hash, stage, blockNumber?.toString() ?? null]);
        if (kind === "pay" && isFailedStage(stage)) await releaseLock(q, hash);
      });
    }
  }
  return payTxView(deps, { ...row, stage, block_number: blockNumber });
}

export function payTxView(deps: Deps, row: any) {
  const v = stageView(row.stage, row.step_kind);
  return {
    txHash: row.tx_hash, txUrl: explorerTx(Number(row.chain_id ?? deps.contracts.chainId), row.tx_hash),
    step: row.step, ...v, blockNumber: row.block_number?.toString() ?? null, paymentIntentId: row.pay_intent_id ?? null, requestId: row.request_id ?? null,
    note: v.stepKind === "approve"
      ? "An approval only lets AtlasPay move this exact amount. It is not a payment; the pay step still has to be sent and mined."
      : v.paid ? "Finalized on-chain."
        : "Not paid yet. ATLAS shows a payment as paid only once its PaymentSent event is final on-chain.",
  };
}

/** Background reconciliation: refresh every open reported tx (bounded). */
export async function reconcilePayTxs(deps: Deps, limit = 100) {
  const rows = await deps.db.sys(`SELECT tx_hash, stage FROM payment_txs WHERE stage IN ('broadcast','mined','confirmed') AND reported_at > now() - interval '7 days' ORDER BY updated_at LIMIT $1`, [limit]);
  let changed = 0;
  for (const r of rows) {
    const before = r.stage;
    const v = await refreshPayTx(deps, r.tx_hash).catch(() => null);
    if (v && v.stage !== before) changed++;
  }
  return { checked: rows.length, changed };
}
