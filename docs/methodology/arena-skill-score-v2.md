# ATLAS Arena 1.0: Skill Score v2, boards and ATLAS Points

Status: **provisional**. These definitions are versioned in code (`services/reputation-engine/src/arena.ts`) and stored with a content hash in `scoring_methodologies`. The API refuses to start if a stored methodology with the same id and version has a different hash, so a definition can only change by publishing a new version. Every leaderboard response includes `methodology` (id, version, hash), `evidenceCoverage`, `calculatedAt` and `finalizedBlock`.

Arena extends ATLAS-M1 (`services/reputation-engine`) and does not replace it. Theses are still resolved by ATLAS-M1 against reference-market evidence, and Reputation v1 is still shown in the Arena methodology modal and on profiles.

## What is scored

- Only **on-chain theses** count: they are committed through `AtlasThesisRegistry` before the outcome. Off-chain drafts are never scored.
- A thesis is **scored** once ATLAS-M1 resolves it as TargetHit, InvalidationHit or Expired with a recorded outcome. Theses resolved as `Disclosed` are shown but not scored.
- A thesis belongs to a window (24h, 7d, 30d, 90d or all) by its **evidence time**, which is when its outcome was resolved.
- On chain 56, rows marked `simulated` (the local demo seed) are always excluded.
- Accounts with an open integrity flag are shown but marked **Unranked**.

### Near-duplicate rule (anti-abuse)

If the same author publishes the same asset and direction within 24h, and the target and invalidation prices are within 0.5% of each other (or the content hash or title is identical), the theses count as near-duplicates. Only the earliest one earns ranking or XP credit. Later copies stay in the public record with the status `excluded_duplicate`, and the system raises a `near_duplicate` integrity flag.

## Skill Score v2 (Top Analysts)

The score runs from 0 to 100. Each component is first normalized to the range [0, 1], so no single extreme value can dominate, and is then weighted:

| Component | Weight | Normalization |
|---|---|---|
| Statistically adjusted success | 35% | Wilson 95% lower bound of wins / resolved. Small samples are pulled down automatically. |
| Risk-aware thesis expectancy | 25% | `0.5 + tanh((avg return bps / max(50, downside deviation bps)) / 2) / 2`, shrunk toward 0.5 by `n/(n+5)` |
| Confidence calibration | 20% | `clamp(0.5 + 2 × (0.25 − Brier))` on declared confidence, shrunk by `n/(n+5)` |
| Consistency across time | 10% | Wilson lower bound of net-positive weeks / active weeks |
| Evidence completeness | 10% | Share of due theses with stored ATLAS-M1 evidence or on-chain finality |

The **Thesis Return Drawdown** is the peak-to-trough drawdown of the cumulative sequence of reference-market thesis returns. It is shown alongside the score but is not a component. It measures thesis outcomes, not realized trading P&L.

### Tiers

| Tier | Rule |
|---|---|
| Emerging | 1–9 qualifying resolved theses. Listed with their record but never ranked. |
| Ranked | 10 or more, with evidence coverage of at least 60% |
| Established | 30 or more, across at least 4 active weeks |
| Unranked | No resolved theses, coverage below 60%, or an open integrity flag |

Use the minimum-sample filter to raise the bar further on any board.

## Other boards

- **Consistent** (`atlas-consistency-v1`): 45% weekly consistency, 35% risk-adjusted expectancy and 20% drawdown score (`1/(1+TRDD/1000)`). It needs at least 5 resolved theses, at least 2 active weeks and evidence coverage of at least 60%. Coverage is shown on every row.
- **Rising Stars** (`atlas-rising-v1`): lists Emerging accounts only. Each needs at least 3 resolved theses in the window, at most 9 resolved all-time, and a first thesis within the last 120 days. The page shows these thresholds.
- **Gainers**: shows **no realized P&L and no "money earned"**. The tab states "Verified realized P&L coming in Arena 2.0". The optional **Top Thesis Moves** list shows reference-market outcomes of TargetHit theses (at most 2 per author) and is labelled "not money earned".
- **Squads**: a placeholder for the Arena 3.0 Squad Championship.
- **24h window**: always carries an "insufficient evidence" warning.

## Snapshots and Rank Journey

`leaderboard_snapshots` and `leaderboard_entries` are append-only: a database trigger rejects UPDATE and DELETE, and the `atlas_app` role has no write grants on them. Each snapshot records the board, window, methodology id, `as_of`, `finalized_block`, evidence coverage, sample size and an input hash.

The idempotency key is `board:window:methodology:contentHash:after:<previous snapshot>`, so running the job twice without a change writes nothing new. The API runs the snapshot job 15s after boot and every 10 minutes after that. Filtered and 24h requests are never snapshotted.

The **Rank Journey** chart on a profile and in the Proof Drawer is read from `/leaderboards/:type/history`.

## ATLAS Points (`atlas-points-v1`)

ATLAS Points are **non-transferable XP**. They are not a token, not cash and not an airdrop, and they carry no promise of future value.

Points live in the append-only `point_events` ledger. Each event has a unique idempotency key, and owners can read only their own events (RLS). Balances, levels and achievements are always **derived** from the ledger and are never incremented in place.

| Action | XP | Limits |
|---|---|---|
| First verified Agent ID onboarding | 20 | Once per identity |
| Properly structured on-chain thesis | 10 | Max 3 per UTC day; near-duplicates earn 0 |
| Thesis reaches a documented resolution (win or lose) | 15 | Once per thesis |
| Substantive, valid review | 8 | 120+ characters and 20+ words; not on your own thesis; not a repeat; max 3 per UTC day |
| Evidence challenge independently upheld | 25 | Once per finding; adjudicated by a moderator who is not the challenger |
| Evidence-quality distinction | 15 | Thesis is final on-chain with stored evidence, was reviewed by another holder, and has no upheld challenge |
| Squad research milestone | 10 | The squad reaches 5, 15 or 30 resolved on-chain theses and you authored one; max 3 lifetime |
| Likes, follows, comments, reposts, trading volume, transaction count | 0 | Never earn XP |

Levels come from cumulative XP. The level thresholds are 0, 40, 100, 200, 350, 550, 800, 1100, 1500, 2000 and 2600.

### Achievements

All achievements are derived from the ledger:

- **Founding Agent ID**: onboarded before 2027-01-01.
- **Thesis Pioneer**: first resolved thesis.
- **Evidence Reviewer**: 3 credited reviews.
- **Weekly Challenger**: resolved theses in 3 different weeks.
- **Squad Contributor**: first squad milestone.

## Explainability

- **Proof Drawer** (`/users/:id/score-breakdown`): shows each component's raw value, normalized value and weighted contribution, along with the sample, period, tier reason, limitations, integrity flags and every thesis with its status (`credited`, `excluded_duplicate`, `outside_window`, `open` or `disclosed_not_scored`), linked to `/proof/:id`.
- **Trader Comparison Lab** (`/traders/compare?ids=a,b[,c]`): compares 2–3 traders side by side. The realized P&L row reads "Arena 2.0".

## Demo data

`pnpm --filter @atlas/api seed` (or `npx tsx src/db/seed.ts --reset`) seeds the local development database. It publishes labelled `[Demo]` theses on the local anvil chain, marks them `simulated`, and flags every board response with `demo: true`, which the UI shows as a banner. The seed refuses to run on chain 56 or in production.

When there is no data, the boards say: "Verified rankings will appear here once Agent ID holders have enough resolved on-chain theses in this window."

## Deferred

- **Arena 2.0**: verified realized P&L (trading lots and wallet-verified fills).
- **Arena 3.0**: Squad Championship and seasons. The `leaderboard_seasons` table exists but is not used for ranking yet.
