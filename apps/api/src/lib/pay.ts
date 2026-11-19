import { formatUnits, type Hex } from "viem";
import { explorerTx } from "@atlas/shared-types";
import { PAY_KINDS } from "@atlas/wallet-integration";
import type { Deps } from "../deps.js";
import type { Q } from "../db/index.js";
import { ApiError } from "./errors.js";

export const PAY_ASSETS = ["BNB", "USDT"] as const;
export type PayAssetName = (typeof PAY_ASSETS)[number];

export const PAY_PENDING_MESSAGE =
  "AtlasPay is pending deployment on this chain. ATLAS will not simulate or fake a payment: use the official Binance Agentic Wallet (baw) fallback, which resolves the Agent ID and sends from your own wallet.";

export function assertPayDeployed(deps: Pick<Deps, "contracts">) {
  if (!deps.contracts.payDeployed) throw new ApiError(503, "CONTRACTS_PENDING", PAY_PENDING_MESSAGE, { fallback: "baw" });
}

const ZERO_ADDR = /^0x0{40}$/i;

/**
 * Indexer projection for AtlasPay `PaymentSent`. Receipts come ONLY from on-chain events (never from the API's
 * own prepare step), so nothing here can show a payment that did not happen. Reorgs delete the chain_events row
 * (payments cascade) and this function re-opens any request the removed payment had settled.
 * Payments are never written to point_events, arena tables, theses or reviews.
 */
export async function applyPayEvent(q: Q, deps: Deps, e: { id: string; name: string; args: any; txHash: string; blockNumber: bigint; blockTime: bigint; address: string }, status: "provisional" | "final", revert = false) {
  if (e.name !== "PaymentSent") return;
  const a = e.args;
  const contextRef = String(a.contextRef).toLowerCase();
  if (revert) {
    await q(`UPDATE payment_requests SET status = 'open', paid_tx_hash = NULL WHERE status = 'paid' AND paid_tx_hash = $1`, [e.txHash.toLowerCase()]);
    return;
  }
  const sender = String(a.sender).toLowerCase();
  const recipient = String(a.recipient).toLowerCase();
  const token = String(a.token).toLowerCase();
  const user = async (w: string) => (await q(`SELECT user_id FROM agent_id_links WHERE chain_id = $1 AND wallet_address = $2 AND revoked_at IS NULL`, [deps.contracts.chainId, w]))[0]?.user_id ?? null;
  const senderId = await user(sender);
  const recipientId = await user(recipient);
  const asset = ZERO_ADDR.test(token) ? "BNB" : token === deps.contracts.stable.toLowerCase() ? "USDT" : "UNKNOWN";
  const [intent] = await q(`SELECT * FROM payment_intents WHERE context_ref = $1`, [contextRef]);
  // an intent only counts if the chain agrees with what the sender was shown
  const matches = intent && intent.sender_id === senderId && intent.expected_recipient === recipient && intent.asset === asset && BigInt(intent.amount_wei) === BigInt(a.amount) && intent.recipient_token_id.toString() === BigInt(a.recipientTokenId).toString();
  await q(
    `INSERT INTO payments (event_id, chain_id, pay_contract, tx_hash, block_number, block_time, sender_wallet, recipient_wallet, sender_token_id, recipient_token_id,
       sender_id, recipient_id, token, asset, amount_wei, kind, context_ref, memo_hash, intent_id, status)
     VALUES ($1,$2,$3,$4,$5,to_timestamp($6),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT (event_id) DO NOTHING`,
    [e.id, deps.contracts.chainId, e.address.toLowerCase(), e.txHash.toLowerCase(), e.blockNumber.toString(), e.blockTime.toString(), sender, recipient,
      BigInt(a.senderTokenId).toString(), BigInt(a.recipientTokenId).toString(), senderId, recipientId, token, asset, BigInt(a.amount).toString(),
      PAY_KINDS[Number(a.kind)] ?? "direct", contextRef, String(a.memoHash).toLowerCase(), matches ? intent.id : null, status],
  );
  if (matches && intent.request_id) {
    await q(`UPDATE payment_requests SET status = 'paid', paid_tx_hash = $2 WHERE id = $1 AND status = 'open'`, [intent.request_id, e.txHash.toLowerCase()]);
  }
}

export const assetDecimals = (_a: string) => 18; // BNB and BSC USDT (BSC-USD) both use 18 decimals

export function receiptView(r: any, me: string) {
  const outgoing = r.sender_id === me;
  return {
    id: r.event_id,
    direction: outgoing ? "sent" : "received",
    status: r.status, // provisional (< confirmations) | final
    chainId: Number(r.chain_id),
    txHash: r.tx_hash,
    txUrl: explorerTx(Number(r.chain_id), r.tx_hash),
    blockTime: r.block_time,
    asset: r.asset,
    token: r.token,
    amount: formatUnits(BigInt(r.amount_wei), assetDecimals(r.asset)),
    kind: r.kind,
    sender: { userId: r.sender_id, agentName: r.sender_agent_name ?? null, displayName: r.sender_display_name ?? null, wallet: r.sender_wallet },
    recipient: { userId: r.recipient_id, agentName: r.recipient_agent_name ?? null, displayName: r.recipient_display_name ?? null, wallet: r.recipient_wallet },
    // linked context: a reference only. Message content is never part of a receipt.
    context: r.intent_id ? { kind: r.context_kind, id: r.context_id, requestId: r.request_id ?? null } : null,
    memo: r.intent_id ? r.memo || null : null,
    memoHash: r.memo_hash,
    contextRef: r.context_ref,
    payContract: r.pay_contract,
  };
}

export function requestView(r: any, deps: Deps) {
  return {
    id: r.id,
    requester: { userId: r.requester_id, agentName: r.requester_agent_name, displayName: r.requester_display_name, avatarUrl: r.requester_avatar_url ?? null },
    payerId: r.payer_id,
    asset: r.asset,
    amount: r.amount,
    note: r.note,
    contextKind: r.context_kind,
    contextId: r.context_id,
    status: r.status === "open" && new Date(r.expires_at).getTime() < deps.now() * 1000 ? "expired" : r.status,
    paidTxHash: r.paid_tx_hash,
    paidTxUrl: r.paid_tx_hash ? explorerTx(deps.contracts.chainId, r.paid_tx_hash) : null,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    sharePath: `/pay/r/${r.id}`,
  };
}

export type { Hex };
