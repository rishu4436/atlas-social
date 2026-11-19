import { getAddress } from "viem";
import { explorerTx, explorerAddress } from "@atlas/shared-types";
import type { Q } from "../db/index.js";

export const BADGE_NOTE = "Agent ID verified: proves control of an Agent ID wallet. Not a verified human, not a verified profitable trader.";

export const PROFILE_COLUMNS = `p.user_id, p.agent_name, p.display_name, p.bio, p.avatar_url, p.topics, p.is_ai_agent, p.ai_operator, p.created_at`;

export function publicProfile(p: any, extra: { wallet?: string | null } = {}) {
  return {
    userId: p.user_id,
    agentName: p.agent_name,
    displayName: p.display_name,
    bio: p.bio,
    avatarUrl: p.avatar_url,
    topics: p.topics,
    classification: p.is_ai_agent ? "AI Agent" : "Agent ID holder",
    aiOperator: p.is_ai_agent ? p.ai_operator : null,
    badge: { agentIdVerified: true, label: "Agent ID verified", note: BADGE_NOTE },
    createdAt: p.created_at,
    wallet: extra.wallet ? getAddress(extra.wallet) : null,
  };
}

export function thesisView(t: any, opts: { includeSalt?: boolean } = {}) {
  if (!t) return null;
  const onchain = t.chain_status === "published" || t.chain_status === "committed";
  const revealed = t.chain_status === "published";
  return {
    id: t.id,
    authorId: t.author_id,
    chainId: Number(t.chain_id),
    registry: t.registry,
    asset: t.asset,
    symbol: t.symbol,
    // commit-reveal theses hide their terms until revealed (unless the viewer is the author)
    direction: revealed || opts.includeSalt || t.visibility === "PUBLIC" ? t.direction : null,
    entryKind: revealed || opts.includeSalt || t.visibility === "PUBLIC" ? t.entry_kind : null,
    entryPrice: revealed || opts.includeSalt || t.visibility === "PUBLIC" ? t.entry_price : null,
    targetPrice: revealed || opts.includeSalt || t.visibility === "PUBLIC" ? t.target_price : null,
    invalidationPrice: revealed || opts.includeSalt || t.visibility === "PUBLIC" ? t.invalidation_price : null,
    horizonHours: t.horizon_hours,
    confidence: t.confidence,
    visibility: t.visibility,
    content: revealed || opts.includeSalt || t.visibility === "PUBLIC" ? t.content : { title: t.content?.title ?? "Private thesis", summary: "Terms are committed on-chain and will be revealed by the author.", body: "" },
    contentHash: t.content_hash,
    commitment: t.commitment,
    salt: opts.includeSalt || revealed ? t.salt : undefined,
    terms: revealed || opts.includeSalt || t.visibility === "PUBLIC" ? t.terms : null,
    chainStatus: t.chain_status,
    // AI-agent-authored (permanent label; ranked only on the AI Analysts board, never in human Skill Score)
    authorType: t.agent_attribution_id ? "agent" : "human",
    scoring: t.scoring_status ? { status: t.scoring_status, source: t.scoring_source ?? null, note: t.scoring_note ?? null, checkedAt: t.scoring_checked_at ?? null } : null,
    badge: onchain ? (revealed ? "On-chain Committed" : "On-chain Committed (terms hidden)") : t.chain_status === "cancelled" ? "Cancelled (kept in record)" : "Draft (not on-chain)",
    onchainId: t.onchain_id,
    publishTx: t.publish_tx,
    publishTxUrl: t.publish_tx ? explorerTx(Number(t.chain_id), t.publish_tx) : null,
    registryUrl: explorerAddress(Number(t.chain_id), t.registry),
    startTime: t.start_time,
    publishedAt: t.published_at,
    outcome: t.outcome,
    outcomeState: t.outcome_state,
    returnBps: t.return_bps,
    returnNote: t.return_bps !== null && t.return_bps !== undefined ? "Direction-adjusted move between entry and exit under ATLAS-M1. Not realized profit." : null,
    resolvedAt: t.resolved_at,
    evidenceHash: t.evidence_hash,
    createdAt: t.created_at,
  };
}

export async function walletOf(q: Q, userId: string): Promise<string | null> {
  const [l] = await q(`SELECT wallet_address FROM agent_id_links WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  return l?.wallet_address ?? null;
}

export function tradeProofView(p: any) {
  if (!p) return null;
  return {
    id: p.id, userId: p.user_id, chainId: Number(p.chain_id), txHash: p.tx_hash, txUrl: explorerTx(Number(p.chain_id), p.tx_hash),
    status: p.status, reasons: p.reasons, evidence: p.evidence, evidenceHash: p.evidence_hash, thesisId: p.thesis_id, createdAt: p.created_at, verifiedAt: p.verified_at,
  };
}
