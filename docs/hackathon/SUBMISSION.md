# Hackathon submission notes (draft; NOT submitted)

Source: Agent ID Hackathon announcement: https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf (copy in `docs/research/hackathon_announcement.txt`).

## Key dates
- Submission period: **2026-11-18 08:00 UTC → 2026-12-09 08:00 UTC** (13:30 IST on 9 Dec).
- Public review: 2026-12-17 08:00 UTC → 2026-12-20 08:00 UTC.

## Requirements and our status
| Requirement | Status |
|---|---|
| Deployed on BNB Chain, actively uses Agent ID | Contracts are Agent ID-gated (`balanceOf`/`ownerOf` on the official registry). **Deployed on BSC mainnet** 2026-11-19 (see addresses below). |
| Source verified and open-sourced on BscScan | **Done**: all five contracts verified on BscScan (and Sourcify exact match); GitHub repo is public. |
| Owner permissions disclosed | README + `/config` + docs/security.md |
| Innovation Award: live product + ≥ 30 Agent ID addresses interacting with our contracts during the period | **Live product: yes** (URLs below). **Address goal: in progress, not met yet.** Live count: [`/metrics/onchain-agents`](https://atlas-social-api.onrender.com/metrics/onchain-agents) (counting rules below). As of the mainnet go-live (2026-11-19) one Agent ID (the owner's) has interacted. |
| Safety red lines | All addressed. See docs/security.md "Hackathon red lines" |

## Form fields (draft)
- **Project name:** ATLAS Social
- **Website:** https://atlascalls.xyz (Vercel; fallback: https://atlas-social-web.vercel.app). API: https://atlas-social-api.onrender.com (Render; free tier, the first request after idle can take ~50 s to wake). MCP: `https://atlas-social-api.onrender.com/mcp`. Health: `/health`, `/health/workers`.
- **Contract addresses (BSC mainnet, verified; details in [docs/deployments/bsc-mainnet.md](../deployments/bsc-mainnet.md)):** AtlasIdentityRegistry [`0x2cc2Dbb408EAE7bb64f75754Da2bc650B9AD7532`](https://bscscan.com/address/0x2cc2Dbb408EAE7bb64f75754Da2bc650B9AD7532#code), AtlasThesisRegistry [`0x7E9071Ccba153e4f340f767511B4afa31F776E5A`](https://bscscan.com/address/0x7E9071Ccba153e4f340f767511B4afa31F776E5A#code), AtlasReviewRegistry [`0xE6c7409CfBbd546207Ea0D33273e640e5B5a1E45`](https://bscscan.com/address/0xE6c7409CfBbd546207Ea0D33273e640e5B5a1E45#code), AtlasOutcomeRegistry [`0xB9A4533dFEb7F44d10ee60e434a1C3800D20a97d`](https://bscscan.com/address/0xB9A4533dFEb7F44d10ee60e434a1C3800D20a97d#code), AtlasPay [`0x425523F9a2A417709124233da27AfCDf0c78007E`](https://bscscan.com/address/0x425523F9a2A417709124233da27AfCDf0c78007E#code)
- **Agent ID usage:** Agent ID is the account. Sign-in requires holding an Agent ID and proving wallet control (EIP-712 via the Agentic Wallet or an on-chain `registerIdentity` proof). One Agent ID maps to one account and one `name.ai` profile. Every thesis, review and evidence challenge is gated on-chain to Agent ID holders, and authorship is bound to the Agent ID token. Reputation is attached to the Agent ID and is built only from on-chain commitments. Agent ID is never used as a wallet-lookup tool.
- **Judging fit:**
  - Application depth (30%): identity, authorship and reputation all hang on Agent ID.
  - Practicality (25%): it fixes unverifiable trading claims.
  - Completion (25%): full social product, contracts, proofs, trade handoff.
  - Innovation (20%): commit-before-outcome theses with independent proofs and AI that cannot trade.

## How "distinct Agent ID addresses interacting on-chain" is counted
- Source: `GET https://atlas-social-api.onrender.com/metrics/onchain-agents` (`?include=all` adds provisional events). Counts only, no address list.
- One address = the actor of an Agent-ID-gated user action on an ATLAS contract on BSC mainnet, read from the reorg-aware
  indexer, lowercased and de-duplicated across actions: `IdentityRegistered.wallet` (on-chain sign-in proof),
  `ThesisCommitted` / `ThesisPublished.author`, `ReviewPublished.reviewer`, `EvidenceChallenged` / `OutcomeChallenged.challenger`,
  `PaymentSent.sender`.
- Not counted: evaluator proposals (`OutcomeProposed`, an ATLAS service key), permissionless `finalizeOutcome`, owner
  `setEvaluator`, payment recipients, EIP-712 logins that never touch the chain, and anything prepared but not mined.
- Default counts events at final depth (15 blocks). Window: the submission period above. The project owner's own Agent ID
  counts as one address and is not padded.

## Real mainnet evidence (two different Agent IDs, 2026-11-20)
- Second holder minadevi.ai signed in with ATLAS Connect (real `baw` EIP-712) and completed a profile.
- Real AtlasPay payment: minadevi.ai → rishug4436.ai 0.0001 BNB, [`0x1ed148db…`](https://bscscan.com/tx/0x1ed148db4a717cc8ddbf2c50f42c942e6ac5497b7890a066bbc3aa4b1c97eaa2), Finalized · paid.
- Second holder's on-chain review of thesis #1: [`0x4b067395…`](https://bscscan.com/tx/0x4b067395dd208c74a7314d741f261812e678be486aaa189a717bdcd386bac38a).
- Real USDT payment: rishug4436.ai → minadevi.ai 0.05 USDT, exact approve [`0xc2f9009f…`](https://bscscan.com/tx/0xc2f9009f347fdb5864f24afce035509f2f6c7c4480d448dcd56494efbccad8d8) (never shown as paid) then `payToken` [`0xecee06c2…`](https://bscscan.com/tx/0xecee06c2d7f572798f86e6262628106ba0efc03afa4e8692f57549d1fbace0d6), Finalized · paid.
- Real payment request: 0.00005 BNB requested by rishug4436.ai, paid by minadevi.ai [`0x7d6af409…`](https://bscscan.com/tx/0x7d6af409edcd559c00b5049ec0a7f23b57a905caf975ef897ce9ad3467fa3991); settled once, further payment blocked.
- `/metrics/onchain-agents`: 2 distinct Agent ID addresses (both controlled by the project owner; not padded beyond that).
- Details: [docs/deployments/bsc-mainnet.md](../deployments/bsc-mainnet.md).

## Outstanding (honest list; not done yet)
- An independent review of the `atlas-baw-connect` companion.
- An authenticated production MCP test (agent token created by a holder, tools exercised against the live API).
- Reaching ≥ 30 distinct Agent ID addresses on-chain during the period.
- Audit response status: [docs/security/audit-response-2026-11-20.md](../security/audit-response-2026-11-20.md).

## Demo script (Blueprint §20)
1. Agent ID login → profile
2. Publish a thesis on-chain (committed-badge reveal)
3. A second holder reviews it on-chain
4. AI challenge → build my own trade on /trade → wallet preview/execute → submit evidence
5. /proof/:id: judges recompute the commitment, see the events, outcome evidence and reputation methodology

Use only real or clearly labelled simulated data in the demo.
