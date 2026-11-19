# ATLAS Pay — security review

Scope: `packages/contracts/src/AtlasPay.sol`, the deploy scripts (`script/Deploy.s.sol`, `script/DeployPay.s.sol`),
the API pay surface (`apps/api/src/routes/pay.ts`, `src/lib/pay.ts`, `migrations/005_pay.sql`, the indexer pay path)
and the web send flow (`apps/web/components/pay/*`). Reviewed 2026-11-19 by the builder. This is not an
independent audit — get one before real volume flows through the contract.

**Status:** AtlasPay is **not deployed** on BSC. A deployer wallet from the user is needed first. Until then the live
API reports `status: "pending"` and the web shows "Contracts pending deployment" with the official Binance
Agentic Wallet (`baw`) fallback. ATLAS never simulates a payment or fakes a receipt.

## Threat model and how it's handled

| # | Threat | Mitigation | Evidence |
|---|---|---|---|
| 1 | **Paying a stale or poisoned address**: the DB cache is wrong, the Agent ID was transferred, or the API was compromised | AtlasPay never takes a recipient address to pay. It calls `ownerOf(recipientTokenId)` on the official registry **at execution**, with tokenId = `uint256(keccak256(handle))`. The sender also passes the `expectedRecipient` they were shown, and the call reverts with `RecipientChanged` if the two differ. Funds can only reach the address the sender saw and approved, and only while that address still owns the Agent ID. | `test_recipientResolvedAtExecution_revokedAfterPreview`, `test_expectedRecipientMustMatchLiveOwner`, `testFuzz_wrongExpectedRecipientNeverPays`, `testFuzz_unknownTokenIdNeverPays`; API returns `409 RECIPIENT_CHANGED` with `details.current` and the UI asks for a fresh review |
| 2 | **Custody / stuck funds** | No storage beyond immutables; no `receive`/`fallback`; BNB is forwarded in the same call; tokens move sender → recipient via `transferFrom` and never touch the contract | Invariants: `invariant_neverHoldsBNB`, `invariant_neverHoldsTokens`, `invariant_tokensConserved` (handler makes random BNB/USDT pays, reverts and self-pays) |
| 3 | **Over-broad approvals** | The API plans `approve(AtlasPay, amount)` only when allowance < amount, for exactly `amount` — never unlimited. `assertSafePaySteps` rejects any step that isn't approve-exact or pay against the configured contracts. | `wallet-integration/test/pay.test.ts`; `test_payToken_exactApproval_noRetainedBalance`, `test_payToken_insufficientApprovalReverts` |
| 4 | **Fee-on-transfer / non-standard tokens** | Only the immutable `stableToken` is accepted (`UnsupportedToken` otherwise). SafeERC20 is used, and a received-amount check reverts with `TokenAmountMismatch`. On chain 56 the deploy guard pins USDT `0x55d3…7955`. | `test_payToken_feeOnTransferRejected`, `test_payToken_onlyTheConfiguredStable` |
| 5 | **Reentrancy** via a malicious recipient | `nonReentrant` on both entry points. The event is emitted before the BNB call. There is no state for a reentrant call to corrupt. | `test_reentrancyIsBlocked` |
| 6 | **Recipient rejects BNB** | `NativeTransferFailed` reverts the whole payment. No receipt is emitted. | `test_refusingRecipientRevertsWholePayment` |
| 7 | **Spoofed sender identity** | The sender must hold an Agent ID (`_verifiedAgentToken`, shared with the other ATLAS contracts). `senderTokenId` comes from the registry, not from calldata. | `test_senderMustHoldAgentId` |
| 8 | **Self-payment loops** (wash-tipping) | `SelfPayment` revert in the contract; the API rejects too | `test_noSelfPayment`; API "nobody can pay themselves" |
| 9 | **Admin key risk** | No owner, admin, pause, upgrade or withdraw. A bug means redeploy and repoint the API. | source; `test_cannotReceivePlainBNB` |
| 10 | **Mis-deploy to mainnet** (wrong registry, mock token, wrong chain) | `DeployPay.checkConfig(chainId, confirm, agentId, stable)` is pure. On 56 it requires `CONFIRM_MAINNET=yes`, the official registry `0x60b9…022f` and BSC USDT, and never deploys `MockStable`. The deployer key is typed by the user at deploy time and is never stored. | `DeployGuards.t.sol` (5 tests) |
| 11 | **API misconfiguration** (pointing at someone else's contract) | Before the first prepare (then cached), the API reads `AtlasPay.agentId()` and `stableToken()` and refuses to prepare unless they match the configured registry and token. Chain 56 forces USDT. | `routes/pay.ts`; preflight `--pay` check |
| 12 | **Address harvesting / wallet directory** | No search or lookup endpoint. `POST /pay/recipient` resolves **one** recipient inside a send flow. It needs a session, CSRF, an Agent ID, and is limited to 10/min and **25 distinct recipients per 24h**. Each resolve is logged as a `pay_resolve` security event. It honours blocks and the recipient's `accept_payments` opt-out. Request share pages never show an address. | `test/pay.test.ts` (rate limit, block, opt-out, unauth); e2e checks that the share page has no `0x…40` |
| 13 | **Receipt privacy** | The contract receives only `contextRef = keccak("atlas-pay:v1:<kind>:<id>:<salt>")` (salted, so it can't be brute-forced from a post id) and `memoHash`. Notes stay in RLS-protected `payment_intents`. DM payments never put message content on-chain or in receipts. | RLS: party-only reads on `payments`/`payment_intents`; DM requests are readable only by members |
| 14 | **Fake success** | The UI only shows "Paid" after the indexer has seen `PaymentSent` for that tx. It shows *Provisional* until finality. A tx hash is described as "broadcast, not confirmed". Intents link to an event only if sender, recipient, asset, amount and tokenId all match. | `ReceiptTracker`; API test "an event that disagrees with what the sender was shown is not linked"; e2e real local tx → indexed receipt |
| 15 | **Reorgs** | `payments.event_id` → `chain_events ON DELETE CASCADE`. Indexer rollback deletes the receipts and re-opens requests. Finalization marks `final` after N confirmations. | `onchain.test.ts` (anvil) + API "re-opens it if a reorg removes the event" |
| 16 | **Score/points manipulation via payments** | Pay code never writes `point_events`, `skill_scores` or anything else Arena reads. Tests snapshot the Arena summary and score breakdown before and after tips and require them to be identical. A source scan asserts `pay.ts`/`lib/pay.ts` never reference Arena tables. | `test/pay.test.ts` "payments and tips never change Arena score, points, levels or achievements" |
| 17 | **Demo data passed off as real** | `seed-pay.ts` runs only locally and **refuses chain 56**. Its payments are real transactions on local anvil, using `MOCK USDT (test only)`. The UI badges a mock stable token. | seed guard |
| 18 | **Phishing via request links** | Requests fix the recipient (the requester), amount and asset. The payer still sees the full resolved address and authorizes in their own wallet. Requests expire and can be cancelled, and a paid request can't be paid twice through ATLAS. | API tests |
| 19 | **Rate limit bypass via a shared proxy IP** | The global limiter now runs at `preHandler`, after the session loads. Signed-in users are keyed by account and anonymous users by IP, so one heavy user can no longer exhaust the bucket for everyone behind a proxy. Pay routes have their own stricter per-route limits. | `app.ts` |

## Residual risks / known limits

- **Front-running a transfer of the recipient's Agent ID** can only cause a revert, never a misdirected payment, because of `expectedRecipient`.
- **The `baw` fallback is outside AtlasPay.** A `baw wallet send` to a resolved address is a plain transfer, so there is no contract check, no `PaymentSent` and no ATLAS receipt. Binance's resolver record for `name.ai` on chain 56 may also differ from the Agent ID NFT owner that AtlasPay pays. The UI flags a mismatch (`baw-differs`) and requires a fresh confirmation for every resolution.
- **USDT on BSC is a centrally-controlled token** and can blacklist addresses. A blacklisted payer or payee makes `transferFrom` revert, and nothing is lost.
- **Gas estimates** for `payToken` after an `approve` can only be approximate before the approval confirms. The UI says so and the wallet shows the final fee.
- **`baw contract-call preview` simulation** has a reported issue (binance-skills-hub#407): view calls aren't executed, so a preview can look successful with invalid arguments. ATLAS runs its own `eth_estimateGas` simulation server-side and surfaces the failure reason.

## Tests

- **forge: 71.** AtlasPay: 17 unit, 4 fuzz and 3 invariants. Deploy guards: 5. The rest are pre-existing.
- **API (vitest): 85.** Pay: 20. Includes a real AtlasPay BNB + USDT run on anvil with indexing, a reorg and finalization.
- **Unit:** `@atlas/auth` pay parser/builders and `wallet-integration` payment planning.
- **E2E (Playwright, local stack, real anvil txs): 7 pay specs**, desktop + mobile: send sheet → real tx → indexed receipt, USDT tip, DM request paid, pending + baw fallback, mobile bottom sheet, share page, reduced motion.
