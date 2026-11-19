# ATLAS Pay: the official Binance Agentic Wallet (`baw`) fallback

Use this when AtlasPay isn't deployed yet (the live API's `/pay/config` reports `status: "pending"`) or when you'd rather
not use the contract. The web send sheet generates these commands for you ("Pay with Binance Agentic Wallet instead").
This page records the flow and how it compares with the official docs.

> **Via ATLAS Connect:** the send sheet's **Hand off to my Agentic Wallet** creates a 30-minute pay code. Your agent or the companion (`atlas-baw-connect pay ATC-…`) runs these same steps (resolve, compare, address book, approval, `wallet send`) and reports the tx hash. ATLAS verifies it on chain against the reviewed transfer. See [atlas-connect-test.md §5](atlas-connect-test.md#5-payment-optional-small-real-amount-your-own-funds).

Sources, re-fetched 2026-11-19 and kept in `docs/research/skills-hub/`:
- `domain-resolve.md`: `wallet resolve-domain` (binance-skills-hub, binance-agentic-wallet/references/domain-resolve.md)
- `send.md`: `wallet send` (…/references/send.md)

## Copy-ready commands (BSC, chain 56)

Step 1: resolve the recipient's Agent ID. Run it yourself and read the output.

```bash
baw wallet resolve-domain --name alice.ai --binanceChainId 56 --json
```

Step 2: **stop and check** the full `address` in the output.
- If `isFallback` is `true`, the Fallback warning applies.
- If `addressType` is `CONTRACT` or `UNKNOWN`, the Contract address warning applies.
- The address must already be in your Binance App address book (Wallet → Settings → Address Book).
- ATLAS also shows the address the Agent ID NFT is held by right now. If the two differ, ATLAS flags it.

Step 3: send, in a **separate, later step**, to the **resolved address** (never the name).

```bash
# BNB (native): the docs use the 0xEeee… sentinel as tokenAddress; --amount is in BNB, not wei
baw wallet send --amount 0.02 --recipient <resolved 0x address> --binanceChainId 56 --tokenAddress 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE --json

# USDT on BSC (BSC-USD, 18 decimals); --amount is in USDT
baw wallet send --amount 10 --recipient <resolved 0x address> --binanceChainId 56 --tokenAddress 0x55d398326f99059fF775485246999027B3197955 --json
```

A returned `txHash` means **broadcast, not confirmed**. Track it with `baw wallet tx-history` and wait for confirmation.

Resolve errors block the payment. Don't retry with a changed name or chain:

| Code | Meaning |
|---|---|
| `20003005` | Unsupported domain format (no dot, or unknown TLD) |
| `20003006` | Chain not compatible with the TLD |
| `20003007` | No address bound on this chain |

## Discrepancies and gotchas (docs vs. the original ATLAS Pay brief vs. reality)

1. **BNB needs a sentinel token address.** `--tokenAddress` is *required* even for native BNB. The docs use
   `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`, not `0x0`/omitted. AtlasPay's own receipts use `address(0)` for BNB.
   ATLAS maps between the two (`bawTokenAddress` in `/pay/config`).
2. **`--amount` is human units** (`1.5`), not wei. ATLAS prints the same decimal string the user typed. It never
   converts to wei for baw.
3. **`--gasLevel` is optional** (`LOW`/`MEDIUM`/`HIGH`, default `MEDIUM`). ATLAS omits it unless a non-default level is chosen.
4. **`--recipient` can't be a domain.** You must resolve first, and the resolved address must be in the Binance App
   address book or the send fails. ATLAS's `bawSendCommand` refuses to build a command with a name as recipient.
5. **`--name` must contain a dot.** ATLAS always passes the full `handle.ai`.
6. **The resolver can differ from the Agent ID owner.** `resolve-domain` returns the name's *resolver record*
   (and can fall back to a default record when there is none for chain 56). AtlasPay instead pays
   `ownerOf(keccak256(handle))` on the Agent ID registry at execution time. These can legitimately differ. ATLAS
   shows both and marks a mismatch. The mandatory warnings still apply.
7. **Resolve and send must happen in separate steps.** The docs forbid sending in the same turn as resolving, and
   every new resolution needs a new confirmation. In the UI, the send command stays locked until you tick a
   confirmation, and pasting a different resolve output clears that tick.
8. **No ATLAS receipt.** A baw transfer is a plain token transfer. It doesn't go through AtlasPay, emits no
   `PaymentSent`, and ATLAS won't show it as paid or settle a request with it. ATLAS never claims otherwise.
9. **`baw contract-call preview` may not simulate view calls** (reported upstream, [binance-skills-hub#375](https://github.com/binance/binance-skills-hub/issues/375)). For the
   AtlasPay path ATLAS runs its own server-side `eth_estimateGas` and shows any revert reason. A clean preview isn't
   proof that a call will succeed.

## When AtlasPay is deployed

The send sheet switches to "Authorize in Agentic Wallet" with `baw contract-call preview`/`execute` commands (and an
EIP-1193 path) for the unsigned transactions ATLAS prepares. There is one `payNative` call for BNB, or an
exact-amount `approve` followed by `payToken` for USDT. See `docs/security/atlas-pay-review.md` and
`docs/runbooks/deploy-bsc.md`.
