# Security

ATLAS follows Blueprint §17. This file maps every required test scenario to the automated test that enforces it, and lists the known gaps.

## Required scenarios (Blueprint §17 table)

| # | Scenario | Required result | Enforced by |
|---|---|---|---|
| 1 | User A requests User B's private bookmarks | Access denied | `apps/api/test/security.test.ts` › "private bookmarks are isolated at API and database (RLS) layers" (also queries as `atlas_app` with B's uid and checks that RLS returns 0 rows) |
| 2 | Same Agent ID attempts a second account registration | Rejected | `apps/api/test/auth.test.ts` › "one Agent ID cannot control two accounts"; DB unique indexes `one_account_per_agent_id`, `one_active_agent_wallet`; contract `test_returningProof_incrementsWithoutRecounting` |
| 3 | Copied wallet signature | Rejected if nonce used, expired or context-mismatched | `auth.test.ts` › "rejects replayed, expired, wrong-signer and context-mismatched signatures"; contract `test_revert_commitmentReplay`, `testFuzz_commitmentsSingleUse`, `invariant_loginCommitmentsSingleUse` |
| 4 | User switches devices or accounts | No private data contamination | `security.test.ts` › "switching accounts on one device revokes the old session and never mixes data", "notifications are delivered only to their recipient" |
| 5 | Attacker claims another person's trade hash | Proof rejected | `packages/trade-proof/test` › "rejects another person's trade hash", "rejects swaps paying a third party…"; API `ALREADY_CLAIMED` guard + unique index `trade_proof_unique_verified` |
| 6 | Modify an on-chain thesis after publication | Original commitment unchanged | contract `invariant_publishedTermsNeverChange`, `test_appendCorrection_appendOnly`, `test_copiedCommitment_cannotBeAttributedToCopier`; `onchain.test.ts` › "…the commitment cannot change"; `/theses/:id/proofs` check `onchainCommitmentUnchanged` |
| 7 | AI-generated post contains malicious signing instructions | Agent tooling ignores them | `security.test.ts` › "research endpoints treat posted text as data and flag injected wallet instructions"; `services/ai-research/test` (scanUntrusted / sanitizeOutput) |
| 8 | Official wallet preview rejects a contract call | ATLAS cannot execute through a bypass | `security.test.ts` › "there is no server-side execution path" (404 for execute/sign/broadcast routes); `wallet-integration` › "assertSafeSteps rejects unlimited approvals"; e2e `trade page requires risk acknowledgement and never offers server-side execution` |
| 9 | Block reorganization affects a recorded proof | Indexer reconciles provisional state | `services/chain-indexer/test/reorg.test.ts` (3 tests); `onchain.test.ts` › "the Postgres-backed indexer ingests ATLAS events and reconciles a reorg" (anvil snapshot/revert) |
| 10 | Price oracle data missing or stale | Outcome remains unresolved | `services/outcome-engine/test` › "missing or stale data => Unresolved after deadline", "a touch after a data gap is not trusted"; contract `test_missingData_unresolvedAfterDeadline`; the evaluator refuses simulated data |
| 11 | Session expires during a protected write | Operation fails, re-auth required | `auth.test.ts` › "expired sessions cannot write", "step-up is required for passkey registration and expires after 10 minutes" |
| 12 | Moderator removes a harmful post | Off-chain visibility changes; on-chain records not misrepresented as deleted | `security.test.ts` › "moderation hides posts off-chain and supports appeals" (a removed thesis post shows "the on-chain commitment is immutable") |

Run them: `forge test` (contracts), `pnpm -r test` (packages/services), `pnpm --filter @atlas/api test` (needs Postgres + anvil), `cd tests/e2e && npx playwright test`.

## Controls

- **Authentication**: EIP-712 `AtlasLogin` typed data (domain `ATLAS Social`, chainId, verifying contract = identity registry) with nonce, audience, issuedAt and expiresAt (5 min). Verification covers EOA via ecrecover and ERC-1271 smart wallets. Agent ID holding is re-checked against the registry at every login. A failed attempt burns the challenge. Fallback: `AtlasIdentityRegistry.registerIdentity(commitment)` from the same wallet; the API checks `commitmentUsedBy(commitment) == wallet`.
- **Sessions**: random 256-bit token, stored as a SHA-256 hash, HttpOnly + SameSite=Lax (+Secure in production), CSRF double-submit (hash stored server-side), Origin allow-list on writes, rotated on login, TTL 7 days, idle 24 h, logout-all. Step-up `wallet_verified_at` is valid for 10 minutes. Passkeys (WebAuthn) never count as a wallet proof.
- **Database**: the application connects as `atlas_app` (no BYPASSRLS, not owner). Every request runs in a transaction with `app.user_id` set locally. Private tables use `FORCE ROW LEVEL SECURITY`. DELETE is revoked on immutable tables (theses, corrections, chain events, moderation actions, security events, trade proofs).
- **Wallet actions**: ATLAS only returns unsigned transactions plus `baw` preview/execute commands. Approvals are exact-amount (`assertSafeSteps`). Price impact above 5% is blocked, slippage is capped at 5% and the recipient is always the user. Tokens come from an allowlist with verified addresses.
- **Links and messages**: links are scanned for shorteners, raw IPs, punycode, look-alike domains and drainer-style paths, and a warning is shown. Direct messages are AES-256-GCM encrypted at rest. They are **not end-to-end encrypted**, and the UI says so.
- **Uploads**: magic-byte type check, 5 MB cap, content-addressed storage (local or S3/MinIO).
- **Production guard**: the API refuses to start with a mock Agent ID, a non-56 chain, synthetic market data, a missing MESSAGE_KEY or a non-https origin.
- **Rate limits** per route (auth, posting, trade, research).

## Hackathon red lines

| Red line | How ATLAS complies |
|---|---|
| No web QR / pairing-code login; no stored sessions placing orders | Login is a signed challenge or an on-chain proof only. No QR or pairing UI exists. Sessions cannot sign anything; there is no execution route. |
| No bypassing transaction confirmation | Every asset action is an unsigned preview executed by the user's wallet (`baw … preview` then `execute`). There are no hidden prompts. |
| Open-source contracts, owner permissions disclosed | See README "Contract owner permissions" and `/config.ownerPowers` in the app. |
| No Binance/BNB branding | The product name is ATLAS. Chain names are used only descriptively. |
| No collection of seed phrases, private keys, API secrets, pairing codes | No such inputs exist. The welcome page and messages warn users. The ATLAS Connect code (`ATC-…`) is **not** a pairing code. It flows from ATLAS to the user's own agent, cannot sign anyone in, and the session is created only in the browser holding the httpOnly verifier ([atlas-connect.md](security/atlas-connect.md)). |
| No promised returns | Copy says "research, not advice". Outcomes are labelled "not realized P&L". |
| Trading pages show risk warnings | `/trade/:asset`, `/markets/*`, `/thesis/:id` and the right panel show them, and prepare requires `acknowledgeRisk: true`. |
| Agent ID is not a wallet-lookup tool | Wallets are hidden by default and never searchable. Explore searches names only. |

## Known gaps (honest status)

- An independent contract audit has **not** been done. Do not route meaningful value through custom contracts until one is.
- `baw sign-message` EIP-712 preview can fail for some apps with error 953004 ([binance-skills-hub#400](https://github.com/binance/binance-skills-hub/issues/400), open). That issue was filed against a different app's EIP-712 login (SOLVD), not ATLAS, so whether ATLAS hits it is unconfirmed. The on-chain `registerIdentity` fallback covers it. `baw contract-call preview` does not execute view calls ([#375](https://github.com/binance/binance-skills-hub/issues/375)); ATLAS simulates server-side.
- **ATLAS Connect** ("Continue with Binance Agentic Wallet"): real `baw` sign-in **confirmed with baw 1.12.0 on Nov 19, 2026** (owner acceptance test, two signatures, no 953004). #400 is still open upstream but was not hit. Acceptance test: [runbooks/atlas-connect-test.md](runbooks/atlas-connect-test.md). The `tools/atlas-baw-connect` companion is a preview, pending dedicated security review, and is not published.
- Real Agent ID login is validated against the official registry ABI (`balanceOf`, `handleOf`) via the on-chain resolver, but has not been run end-to-end with a real Agentic Wallet from this environment.
- A dependency audit (`pnpm audit`) should be run before release.
