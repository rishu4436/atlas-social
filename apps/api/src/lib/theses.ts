import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import {
  Direction, EntryKind, Comparator, OutcomeKind, marketByAsset, tokenBySymbol, toPrice8, computeThesisCommitment, randomSalt,
  METHODOLOGY_CURRENT_HASH, thesisContentHash, validateTerms, type ThesisTerms, type ThesisDraftInput, type ThesisContent,
} from "@atlas/shared-types";
import type { Deps } from "../deps.js";
import type { Q } from "../db/index.js";
import { bad } from "./errors.js";

export const termsToJson = (t: ThesisTerms) => JSON.parse(JSON.stringify(t, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
export function termsFromJson(j: any): ThesisTerms {
  return {
    baseAsset: getAddress(j.baseAsset), quoteAsset: getAddress(j.quoteAsset), direction: Number(j.direction),
    entry: { kind: Number(j.entry.kind), price: BigInt(j.entry.price) },
    target: { comparator: Number(j.target.comparator), price: BigInt(j.target.price) },
    invalidation: { comparator: Number(j.invalidation.comparator), price: BigInt(j.invalidation.price) },
    evaluationDeadline: BigInt(j.evaluationDeadline), methodologyHash: j.methodologyHash, contentHash: j.contentHash,
  };
}

export function buildContent(d: ThesisDraftInput, symbol: string): ThesisContent {
  return { version: 1, title: d.title, summary: d.summary, body: d.body, market: symbol, timeframe: "1h", confidence: d.confidence, sources: d.sources };
}

/** Builds canonical on-chain terms from a draft. Validates against the current market price. */
export function buildTerms(d: ThesisDraftInput, nowS: number, currentPrice: number | null) {
  const m = marketByAsset(d.asset);
  if (!m) throw bad("UNSUPPORTED_ASSET", `Unsupported market ${d.asset}`);
  const base = tokenBySymbol(m.base)!, quote = tokenBySymbol(m.quote)!;
  const long = d.direction === "LONG";
  const entryKind = d.entryKind === "MARKET" ? EntryKind.Market : d.entryKind === "AT_OR_BELOW" ? EntryKind.AtOrBelow : EntryKind.AtOrAbove;
  if (entryKind !== EntryKind.Market && !d.entryPrice) throw bad("ENTRY_PRICE_REQUIRED", "Limit entries need an entry price");
  const content = buildContent(d, m.symbol);
  const terms: ThesisTerms = {
    baseAsset: base.address, quoteAsset: quote.address,
    direction: long ? Direction.Long : Direction.Short,
    entry: { kind: entryKind, price: entryKind === EntryKind.Market ? 0n : toPrice8(d.entryPrice!) },
    target: { comparator: long ? Comparator.GTE : Comparator.LTE, price: toPrice8(d.targetPrice) },
    invalidation: { comparator: long ? Comparator.LTE : Comparator.GTE, price: toPrice8(d.invalidationPrice) },
    evaluationDeadline: BigInt(nowS + d.horizonHours * 3600),
    methodologyHash: METHODOLOGY_CURRENT_HASH,
    contentHash: thesisContentHash(content),
  };
  const err = validateTerms(terms, BigInt(nowS), terms.evaluationDeadline);
  if (err) throw bad("INVALID_TERMS", `Thesis terms invalid: ${err}`);
  if (currentPrice !== null && entryKind === EntryKind.Market) {
    const t = Number(d.targetPrice), inv = Number(d.invalidationPrice);
    if (long && !(t > currentPrice && inv < currentPrice)) throw bad("LEVELS_VS_PRICE", `For a long at market (~${currentPrice}), target must be above and invalidation below the current price`);
    if (!long && !(t < currentPrice && inv > currentPrice)) throw bad("LEVELS_VS_PRICE", `For a short at market (~${currentPrice}), target must be below and invalidation above the current price`);
  }
  return { terms, content, market: m };
}

export function newCommitment(deps: Deps, author: Address, terms: ThesisTerms, salt: Hex = randomSalt()) {
  return { salt, commitment: computeThesisCommitment({ chainId: deps.contracts.chainId, registry: deps.contracts.thesis, author, terms, salt }) };
}

export const noteHash = (note: string) => keccak256(toBytes(note));

export const OUTCOME_NAMES: Record<number, string> = {
  [OutcomeKind.None]: "Open", [OutcomeKind.TargetHit]: "TargetHit", [OutcomeKind.InvalidationHit]: "InvalidationHit", [OutcomeKind.Expired]: "Expired",
  [OutcomeKind.Unresolved]: "Unresolved", [OutcomeKind.Void]: "Void", [OutcomeKind.Forfeited]: "Forfeited",
};
const STATES = ["None", "Proposed", "Challenged", "Final"];

/**
 * Applies an indexed ATLAS contract event to the off-chain projection. Idempotent; used by both the
 * /confirm endpoints (fast path) and the chain indexer (authoritative path). `revert` undoes provisional
 * effects when a reorg removes the event.
 */
export async function applyChainEvent(q: Q, deps: Deps, ev: { name: string; args: any; txHash: string; blockNumber: bigint; blockTime: bigint; contract: string }, revert = false) {
  const a = ev.args;
  const reg = deps.contracts.thesis.toLowerCase();
  switch (ev.name) {
    case "ThesisCommitted":
    case "ThesisPublished": {
      const commitment = String(a.commitment).toLowerCase();
      if (revert) {
        await q(`UPDATE theses SET chain_status = CASE WHEN $3 = 'ThesisPublished' AND visibility = 'COMMIT_REVEAL' THEN 'committed' ELSE 'draft' END,
                 onchain_id = CASE WHEN $3 = 'ThesisPublished' AND visibility = 'COMMIT_REVEAL' THEN onchain_id ELSE NULL END,
                 publish_tx = CASE WHEN $3 = 'ThesisPublished' AND visibility = 'COMMIT_REVEAL' THEN publish_tx ELSE NULL END
                 WHERE registry = $1 AND commitment = $2`, [reg, commitment, ev.name]);
        return;
      }
      const status = ev.name === "ThesisPublished" ? "published" : "committed";
      await q(
        `UPDATE theses SET chain_status = CASE WHEN chain_status = 'published' THEN 'published' ELSE $3 END, onchain_id = $4,
           publish_tx = coalesce(publish_tx, $5), publish_block = coalesce(publish_block, $6), start_time = coalesce(start_time, to_timestamp($7)),
           published_at = CASE WHEN $3 = 'published' THEN coalesce(published_at, to_timestamp($7)) ELSE published_at END
         WHERE registry = $1 AND commitment = $2 AND chain_status IN ('draft','committed','published')`,
        [reg, commitment, status, a.thesisId.toString(), ev.txHash, ev.blockNumber.toString(), ev.blockTime.toString()],
      );
      if (status === "published") {
        const [t] = await q(`SELECT id, author_id, squad_id FROM theses WHERE registry = $1 AND commitment = $2`, [reg, commitment]);
        if (t) {
          const exists = await q(`SELECT 1 FROM posts WHERE thesis_id = $1`, [t.id]);
          if (!exists.length) await q(`INSERT INTO posts (author_id, kind, body, thesis_id, squad_id, topics) VALUES ($1,'thesis','',$2,$3,'{thesis}')`, [t.author_id, t.id, t.squad_id]);
        }
      }
      return;
    }
    case "ThesisCancelled": {
      if (revert) return; // cancellations are rare; provisional cancels are re-applied by the indexer on the canonical chain
      await q(`UPDATE theses SET chain_status = 'cancelled', cancelled_after_start = NOT $3, outcome = CASE WHEN $3 THEN 'Forfeited' ELSE 'Cancelled' END
               WHERE registry = $1 AND onchain_id = $2`, [reg, a.thesisId.toString(), Boolean(a.beforeReveal)]);
      return;
    }
    case "CorrectionAppended": {
      if (revert) { await q(`UPDATE thesis_corrections SET tx_hash = NULL, idx = NULL WHERE tx_hash = $1`, [ev.txHash]); return; }
      await q(`UPDATE thesis_corrections c SET tx_hash = $3, idx = $4 FROM theses t WHERE t.id = c.thesis_id AND t.registry = $1 AND t.onchain_id = $2 AND c.note_hash = $5 AND c.tx_hash IS NULL`,
        [reg, a.thesisId.toString(), ev.txHash, Number(a.index), String(a.noteHash).toLowerCase()]);
      return;
    }
    case "ReviewPublished": {
      const status = revert ? "offchain" : "published";
      await q(`UPDATE reviews r SET onchain_status = $3, tx_hash = ${revert ? "NULL" : "$4"} FROM theses t WHERE t.id = r.thesis_id AND t.registry = $1 AND t.onchain_id = $2 AND r.content_hash = $5`,
        revert ? [reg, a.thesisId.toString(), status, null, String(a.contentHash).toLowerCase()] : [reg, a.thesisId.toString(), status, ev.txHash, String(a.contentHash).toLowerCase()]);
      return;
    }
    case "EvidenceChallenged": {
      if (revert) { await q(`UPDATE evidence_challenges SET tx_hash = NULL WHERE tx_hash = $1`, [ev.txHash]); return; }
      await q(`UPDATE evidence_challenges c SET tx_hash = $3 FROM theses t WHERE t.id = c.thesis_id AND t.registry = $1 AND t.onchain_id = $2 AND c.reason_hash = $4 AND c.tx_hash IS NULL`,
        [reg, a.thesisId.toString(), ev.txHash, String(a.reasonHash).toLowerCase()]);
      return;
    }
    case "OutcomeProposed":
    case "OutcomeChallenged":
    case "OutcomeFinalized": {
      if (revert) return;
      const state = ev.name === "OutcomeProposed" ? "Proposed" : ev.name === "OutcomeChallenged" ? "Challenged" : "Final";
      const outcome = a.outcome !== undefined ? OUTCOME_NAMES[Number(a.outcome)] : null;
      await q(`UPDATE theses SET outcome_state = $3, outcome = coalesce($4, outcome), resolved_at = CASE WHEN $3 = 'Final' THEN to_timestamp($5) ELSE resolved_at END WHERE registry = $1 AND onchain_id = $2`,
        [reg, a.thesisId.toString(), state, state === "Challenged" ? null : outcome, ev.blockTime.toString()]);
      return;
    }
  }
  void STATES;
}
