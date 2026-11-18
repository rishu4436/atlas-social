# Tester onboarding: recruiting 30+ Agent ID participants

The Innovation Award requires a **live product** and **at least 30 Agent ID addresses interacting with our submitted contracts during the submission period** (2026-11-18 08:00 UTC → 2026-12-09 08:00 UTC). The Pioneer Award ranks by interacting Agent ID holders, volume and tx count. Source: https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf

**What counts:** an on-chain transaction from an Agent ID holder's address to an ATLAS contract: `registerIdentity` (sign-in fallback or the home "Anchor your Agent ID" card), `publishThesis`/`commitThesis`, `publishReview`, `challengeEvidence`. A signature-only login is **not** an on-chain interaction. Ask every tester to complete at least the anchor step.

## Rules for the campaign (stay inside the red lines)
- Do not promise returns, profits, airdrops or "earning". ATLAS is a research and reputation tool.
- Never ask testers for seed phrases, private keys, API secrets, pairing codes or screenshots of them. Never offer to "sign for them".
- Testers act from **their own** wallet and confirm every transaction themselves.
- One Agent ID per person is enforced by Agent ID itself. Do not create or fund wallets for people. Do not run scripts that interact on anyone's behalf.
- Don't use "Binance"/"BNB" in the project or campaign branding. Saying "built for Agent ID on BNB Chain" descriptively is fine.
- Wallet addresses are private by default on ATLAS. Do not publish testers' addresses without consent.

## Tester checklist (share this)
1. **Get an Agent ID:** Binance App → Web3 wallet → Agentic Wallet → claim your `.ai` Agent ID.
2. **Install the CLI** (optional but needed for the CLI path): `npm i -g @binance/agentic-wallet`, then `baw auth signin` inside your own Binance flow.
3. **Turn on Developer Mode** (App → Agentic Wallet → Settings). It lasts 7 days.
4. **Keep a small amount of BNB** for gas (a few cents per action).
5. **Sign in:** go to `https://<atlas>/welcome` and enter your Agent ID wallet. Use the sign-message flow, or "On-chain proof" if signing fails.
6. **Anchor your Agent ID** (the card on Home): one `registerIdentity` tx, with no value and no approval. ← this is the step that counts.
7. **Publish one thesis** (Compose → Trade Thesis), or **review someone else's** on-chain. Any honest view is fine, including "I don't know". Reviews can dispute.
8. Optional: join a squad, follow people, try the AI desk.
9. Tell us about bugs via the feedback form or channel (never include keys or codes).

## Recruiting plan
| Week | Action | Target |
|---|---|---|
| Nov 18–24 | Go live (go-live runbook). Team + friends who already hold Agent IDs run the real sign-in test. | 5 holders, first theses on-chain |
| Nov 25–Dec 1 | Post a walkthrough thread and a short demo video on X, plus the developer/trader communities you belong to. Run a "publish your first verifiable thesis" week with a public leaderboard (reputation is never based on profit). | 20 holders |
| Dec 2–8 | Office hours / live onboarding call. Fix friction from feedback. Remind people to anchor. | 30+ holders (aim for 45 for margin) |
| Dec 8 | Freeze. Export evidence. Submit before **Dec 9 08:00 UTC (13:30 IST)**. | — |

## Tracking (no private data)
- Count distinct `from` addresses that interacted with the four ATLAS contracts using BscScan (contract → Transactions → export CSV), then confirm each is an Agent ID holder with `balanceOf(addr) > 0` on `0x60B9…022F`. A small read-only script can do this from the CSV. Keep the counts and not the identities in public evidence.
- In-app, the moderation console shows totals for users / Agent IDs / on-chain theses.

## Message template (draft; the owner decides where and whether to post)
> I'm building ATLAS, a social research network for Agent ID holders: you publish a trade thesis on-chain *before* the outcome, and anyone can verify it later. No custody, no copy-trading, no promised returns: just verifiable research. If you have an Agent ID, I'd love 5 minutes of your time: sign in at <link>, anchor your Agent ID (one tx, gas only), and publish or review one thesis. Never share your seed phrase or keys with anyone, including us.
