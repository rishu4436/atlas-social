# AtlasPay: payment status, request settlement and memo commitments

Status: off-chain fixes shipped 2026-11-20 (audit F3/F4). **No contract was redeployed.** The deployed AtlasPay on BSC
mainnet (see `docs/deployments/bsc-mainnet.md`) is unchanged.

## 1. Payment lifecycle (F3)

ATLAS keeps five stages distinct everywhere (web send sheet, ATLAS Connect handoff, MCP connect tools, the
`atlas-baw-connect` companion). The shared model is `packages/auth/src/pay-status.ts`.

| Stage | Meaning | Source of truth |
|---|---|---|
| Prepared | Unsigned steps built; nothing sent | `/pay/prepare` |
| Broadcast | A tx hash matches the reviewed step; no receipt yet | `getTransaction` |
| Mined | Successful receipt; PaymentSent not indexed yet | `getTransactionReceipt` |
| Confirmed | PaymentSent indexed (provisional, reorg can remove it) | indexer `payments.status = provisional` |
| Finalized | PaymentSent at final depth (15 blocks on BSC) — **the only "paid"** | indexer `payments.status = final` |

Failures: `reverted` (mined, failed), `replaced` (sender nonce used by another tx), `dropped` (unknown after 10 min).
A USDT `approve` only reaches `approval_mined` and is never shown as a payment; the browser wallet path and the
companion wait for it before sending the pay step. `{ verified: true, mined: false }` from
`/auth/connect/handoff/tx` means "matches what you reviewed", and the response now also carries `stage`, `paid: false`.

Endpoints: `POST /pay/intents/:id/tx` (browser/pasted hash), `GET /pay/tx/:hash` (parties only),
`POST /auth/connect/handoff/tx-status`, MCP `atlas_connect_tx_status`. Reported txs live in `payment_txs`
(system role only) and are reconciled in the background.

## 2. Payment requests (F4)

**Contract-level limitation.** AtlasPay v1 has no notion of a request. `contextRef` is an opaque bytes32 and the
contract forwards funds and emits `PaymentSent` for any valid call. It therefore **cannot refuse a second payment for
the same request**, and ATLAS cannot stop a user from broadcasting one from their own wallet.

What ATLAS enforces off-chain:

1. **Settlement = first finalized matching PaymentSent** (block order, then log index). A matching event must agree
   with the reviewed intent (sender, recipient, asset, amount, Agent ID token). `payment_requests.settled_event_id`
   records it. Provisional events never settle a request.
2. **Pending lock.** Once a matching pay tx is reported (Connect, browser wallet or pasted hash) or a matching event is
   provisionally indexed, the request shows `pending`, the Pay button is hidden and `/pay/prepare` (and
   `/pay/handoff`) return `409 REQUEST_PENDING`. The lock expires after 30 minutes for a broadcast-only tx (24 h for a
   provisional event), and is released at once if the tx is reverted, replaced or dropped, or a reorg removes the event.
3. **Duplicates are shown honestly.** Any later matching payment stays a normal receipt (funds did move) with
   `duplicate: true` and a note naming the settling tx. Refunds are between the two parties; ATLAS holds no funds.

Residual risk: two tabs that both prepared before either broadcast, or a sender who ignores the UI, can still pay twice
on-chain. Only a contract change removes this.

### v2 plan (not deployed; needs a new audit and the owner's decision)

- `AtlasPayV2.payRequest(requestId, …)`: an on-chain `settled[requestId]` mapping; the second call reverts
  `RequestAlreadySettled`. `requestId` = keccak(salted ATLAS request id) so it stays unlinkable.
- Optional requester-signed EIP-712 request (amount, asset, recipient token, expiry, nonce) verified on-chain, so the
  amount and expiry are enforced by the contract instead of the API.
- Keep `PaymentSent` unchanged and add `RequestSettled(requestId, paymentTx)`; the indexer then settles from the chain.
- Migration: v1 stays live for direct payments and tips; requests switch to v2 behind a config flag after audit.

## 3. Memo commitments (F4)

- **Before 2026-11-20 (v1, `keccak-utf8-v1`)**: `memoHash = keccak256("atlas-pay-memo:v1:" + memo)`. Deterministic: anyone
  can test guessed memos against the on-chain hash. These receipts stay as they are (the chain is immutable) and still
  verify with `verifyMemo(memo, hash)`.
- **From now on (v2, `salted-keccak-v2`)**: a fresh random 32-byte salt per payment,
  `memoHash = keccak256(salt ‖ "atlas-pay-memo:v2:" ‖ memo)`. The salt is stored off-chain in `payment_intents.memo_salt`
  and returned only to the sender and recipient (prepare response and receipts, protected by RLS). An empty memo stays
  `bytes32(0)`.
- **Compatibility**: the deployed `PaymentSent.memoHash` is an opaque `bytes32` the contract passes through unchanged, so
  v2 hashes fit the deployed event format with no contract change. Receipts carry `memoScheme` so verifiers pick the rule.
