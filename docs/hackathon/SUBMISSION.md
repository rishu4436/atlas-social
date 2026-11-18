# Hackathon submission notes (draft; NOT submitted)

Source: Agent ID Hackathon announcement: https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf (copy in `docs/research/hackathon_announcement.txt`).

## Key dates
- Submission period: **2026-11-18 08:00 UTC → 2026-12-09 08:00 UTC** (13:30 IST on 9 Dec).
- Public review: 2026-12-17 08:00 UTC → 2026-12-20 08:00 UTC.

## Requirements and our status
| Requirement | Status |
|---|---|
| Deployed on BNB Chain, actively uses Agent ID | Contracts are Agent ID-gated (`balanceOf`/`ownerOf` on the official registry). **Mainnet deploy pending** (needs a funded key). |
| Source verified and open-sourced on BscScan | Deploy script uses `--verify`. **Pending** (needs a BscScan API key + deploy). Note: the GitHub repo is currently private; make it public, or at least ensure BscScan verification, before submitting. |
| Owner permissions disclosed | README + `/config` + docs/security.md |
| Innovation Award: live product + ≥ 30 Agent ID addresses interacting with our contracts during the period | **Pending**: needs hosting + user onboarding (each login via `registerIdentity` / thesis / review is a contract interaction) |
| Safety red lines | All addressed. See docs/security.md "Hackathon red lines" |

## Form fields (draft)
- **Project name:** ATLAS Social
- **Website:** _TBD (hosting)_
- **Contract addresses (BSC):** AtlasIdentityRegistry _TBD_, AtlasThesisRegistry _TBD_, AtlasReviewRegistry _TBD_, AtlasOutcomeRegistry _TBD_
- **Agent ID usage:** Agent ID is the account. Sign-in requires holding an Agent ID and proving wallet control (EIP-712 via the Agentic Wallet or an on-chain `registerIdentity` proof). One Agent ID maps to one account and one `name.ai` profile. Every thesis, review and evidence challenge is gated on-chain to Agent ID holders, and authorship is bound to the Agent ID token. Reputation is attached to the Agent ID and is built only from on-chain commitments. Agent ID is never used as a wallet-lookup tool.
- **Judging fit:**
  - Application depth (30%): identity, authorship and reputation all hang on Agent ID.
  - Practicality (25%): it fixes unverifiable trading claims.
  - Completion (25%): full social product, contracts, proofs, trade handoff.
  - Innovation (20%): commit-before-outcome theses with independent proofs and AI that cannot trade.

## Demo script (Blueprint §20)
1. Agent ID login → profile
2. Publish a thesis on-chain (committed-badge reveal)
3. A second holder reviews it on-chain
4. AI challenge → build my own trade on /trade → wallet preview/execute → submit evidence
5. /proof/:id: judges recompute the commitment, see the events, outcome evidence and reputation methodology

Use only real or clearly labelled simulated data in the demo.
