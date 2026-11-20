# Runbook: outcome evaluator worker (audit 2026-11-20 F5)

## What runs where

| Job | Cadence | Durable state | Startup |
|---|---|---|---|
| `outcome-evaluator` | 5 min | writes the thesis outcome **and** the `outcome_proposals` outbox row in one transaction | 30 s after boot |
| `outcome-proposals` | 2 min | `outcome_proposals` state machine, `outcome_proposal_events` log, `worker_leases` lease | 10 s after boot: reconciles every in-flight tx by receipt / registry before sending anything new |
| `pay-reconcile` | 2 min | `payment_txs` stages; releases request locks of reverted / replaced / dropped txs | 12 s after boot |
| `arena-snapshots` | 10 min | versioned snapshots | 15 s after boot |
| indexer | continuous (3 s) | `chain_cursor`, `chain_blocks`, `chain_events` (reorg-aware) | on boot |
| watchdog | 5 min | none (reads the above) | 90 s after boot |

Every job records `worker_runs` (last start / ok / error, consecutive failures). Nothing lives only in memory, so a
Render restart or a sleeping free-tier instance loses nothing: the next pass picks up from Postgres.

## Health and alerts

- `GET https://atlas-social-api.onrender.com/health/workers` — public, secret-free: per-worker heartbeat and lateness,
  indexer head / indexed block / lag, outcome proposals by state (pending, stuck > 30 min, awaiting finalize), the
  evaluator **address**, BNB balance, `authorizedOnChain` (`isEvaluator`), open payment txs, and `problems[]`.
- Alerts are log lines starting with `[atlas-alert]` (Render → Logs, or a log drain filter). Codes:
  `WORKER_FAILING` (3 failures in a row), `WORKER_LATE` (3 missed intervals), `INDEXER_LAG` (> 200 blocks),
  `INDEXER_STALE` (> 10 min), `RPC_UNAVAILABLE`, `PROPOSALS_STUCK`, `EVALUATOR_LOW_BALANCE`
  (below `EVALUATOR_MIN_BALANCE_BNB`, default 0.00005 BNB), `EVALUATOR_NOT_AUTHORIZED`, `EVALUATOR_MISSING`,
  plus `evaluator out of gas funds` from the proposal worker itself.

## Key isolation (recommended next step)

Today the evaluator key (`EVALUATOR_PRIVATE_KEY`) lives in the **web API** service on Render. That process also serves
public HTTP traffic, so an API compromise would expose the key. The evaluator can only *propose* outcomes (anyone with an
Agent ID can challenge during the dispute window, and it holds no user funds), but it should still be isolated:

1. Create a dedicated Render **background worker** (same repo, `RUN_WORKERS=true`, no public port) and move
   `EVALUATOR_PRIVATE_KEY` there. Set `RUN_WORKERS=false` (or remove the key) on the web API. The outbox and leases are in
   Postgres, so the API and the worker can be deployed independently and never double-send.
2. Use a **fresh** evaluator EOA, created only for this, never reused, never imported into a personal wallet.
3. Keep **limited funds**: a few cents of BNB (≈ 0.0005 BNB covers dozens of proposals at BSC's ~0.05 gwei). Top up from
   a separate wallet when `EVALUATOR_LOW_BALANCE` fires. Never fund it from, or sign for it with, the owner's Agentic Wallet.
4. The owner authorizes the new address with `setEvaluator(<new>, true)` and revokes the old one (below).

## Revocation procedure (compromise, rotation or decommission)

1. **Revoke on-chain**: the AtlasOutcomeRegistry owner (the owner's Agentic Wallet) calls
   `setEvaluator(<evaluator address>, false)` on AtlasOutcomeRegistry `0xB9A4533dFEb7F44d10ee60e434a1C3800D20a97d` (BSC mainnet, see `docs/deployments/bsc-mainnet.md`; current evaluator `0x3DBEDBA2c3D9009d8cca39B3eF5f575ba5629B7E`), previewed and approved
   in baw like every owner action. After it is mined, `isEvaluator(<addr>)` is `false` and any further
   `proposeOutcome` from that key reverts. `/health/workers` shows `EVALUATOR_NOT_AUTHORIZED`.
2. **Remove the key** from Render (delete `EVALUATOR_PRIVATE_KEY`, redeploy). The outbox keeps rows in
   `PROPOSAL_PENDING` without burning attempts (`last_error = no evaluator key configured`).
3. **Challenge** any bad proposal still inside its dispute window (any Agent ID holder can call `challengeOutcome`).
   Proposals by a revoked evaluator that were not challenged can still be finalized by anyone after the window; review
   `outcome_proposal_events` for the affected theses.
4. **Sweep** remaining BNB from the old evaluator if the key is still under your control.
5. **Rotate**: create a new EOA, set it on the worker, `setEvaluator(<new>, true)` from the owner wallet, watch the next
   `outcome-proposals` run reconcile and send.

ATLAS automation never signs owner actions: `setEvaluator` is always done by the owner in their own wallet.
