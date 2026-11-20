import { formatUnits, type Hex } from "viem";
import { explorerTx } from "@atlas/shared-types";
import { PAY_KINDS } from "@atlas/wallet-integration";
import type { Deps } from "../deps.js";
import type { Q } from "../db/index.js";
import { ApiError } from "./errors.js";
import { lockRequest, releaseLock, settleRequests } from "./paytx.js";

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
    // only provisional events can be rolled back, and they never settle a request: release the pending lock
    await releaseLock(q, e.txHash);
    await q(`UPDATE payment_requests SET status = 'open', paid_tx_hash = NULL, settled_event_id = NULL WHERE status = 'paid' AND settled_event_id = $1`, [e.id]);
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
    // audit F4: a provisional event only holds the request (pending lock). Settlement = first FINAL matching event.
    if (status === "final") await settleRequests(q, [intent.request_id]);
    else await lockRequest(q, intent.request_id, e.txHash, "provisional", deps.now());
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
    // F4: v2 receipts carry a per-payment salt (only the two parties can read it); v1 receipts used a deterministic hash
    memoScheme: r.intent_id ? r.memo_scheme ?? "keccak-utf8-v1" : null,
    memoSalt: r.intent_id ? r.memo_salt ?? null : null,
    // F3: provisional = PaymentSent indexed (Confirmed), final = Finalized. Only final is "paid".
    stage: r.status === "final" ? "finalized" : "confirmed",
    paid: r.status === "final",
    contextRef: r.context_ref,
    payContract: r.pay_contract,
  };
}

/**
 * F4 duplicate receipts: AtlasPay v1 cannot refuse a second payment for the same request on-chain, so ATLAS shows any
 * later matching payment honestly as a duplicate of the settling one (or of the tx currently holding the lock).
 */
export function duplicateInfo(r: any, req: { status: string; settled_event_id: string | null; paid_tx_hash: string | null; pending_tx_hash: string | null } | undefined) {
  if (!r.request_id || !req) return { duplicate: false, duplicateNote: null };
  const settledByOther = req.settled_event_id && req.settled_event_id !== r.event_id;
  const heldByOther = !req.settled_event_id && req.pending_tx_hash && req.pending_tx_hash !== r.tx_hash;
  if (!settledByOther && !heldByOther) return { duplicate: false, duplicateNote: null };
  return {
    duplicate: true,
    duplicateNote: settledByOther
      ? `Duplicate payment: this request was already settled by tx ${req.paid_tx_hash}. AtlasPay v1 cannot block a second on-chain payment; ATLAS does not count it toward the request. Any refund is between the two parties.`
      : `Possible duplicate: another payment for this request (tx ${req.pending_tx_hash}) is already pending. Only the first one to finalize settles the request.`,
  };
}

export function requestView(r: any, deps: Deps) {
  const pendingLive = r.status === "open" && r.pending_tx_hash && r.pending_until && new Date(r.pending_until).getTime() > deps.now() * 1000;
  return {
    id: r.id,
    requester: { userId: r.requester_id, agentName: r.requester_agent_name, displayName: r.requester_display_name, avatarUrl: r.requester_avatar_url ?? null },
    payerId: r.payer_id,
    asset: r.asset,
    amount: r.amount,
    note: r.note,
    contextKind: r.context_kind,
    contextId: r.context_id,
    status: pendingLive ? "pending" : r.status === "open" && new Date(r.expires_at).getTime() < deps.now() * 1000 ? "expired" : r.status,
    // F4: a matching payment is broadcast or provisionally indexed; Pay is blocked until it finalizes, fails or the lock expires
    pending: pendingLive ? { txHash: r.pending_tx_hash, txUrl: explorerTx(deps.contracts.chainId, r.pending_tx_hash), until: r.pending_until, note: "A payment for this request is on its way. It counts only once it is final on-chain." } : null,
    settledEventId: r.settled_event_id ?? null,
    paidTxHash: r.paid_tx_hash,
    paidTxUrl: r.paid_tx_hash ? explorerTx(deps.contracts.chainId, r.paid_tx_hash) : null,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    sharePath: `/pay/r/${r.id}`,
  };
}

export type { Hex };
