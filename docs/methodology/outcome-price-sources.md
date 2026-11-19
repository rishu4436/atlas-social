# Outcome price sources (ATLAS-M1 / ATLAS-M1.1)

Theses commit to a methodology hash before the market moves, so the price source is part of the committed rules.

| Methodology | Hash constant | Allowed sources, in order |
|---|---|---|
| ATLAS-M1 (legacy) | `METHODOLOGY_M1_HASH` | Binance Spot public klines only |
| **ATLAS-M1.1** (current; new theses) | `METHODOLOGY_M1_1_HASH` | Binance Spot public klines → OKX public candles (`/api/v5/market/history-candles`, `BASE-USDT`, `1H`) |

Rules (`services/outcome-engine` `evaluateWithSources`, used by `workers/outcomes.ts` and `POST /theses/:id/evaluate`):

- **One source per window.** The whole evaluation window is fetched from a single source; a source that fails part-way is discarded and the next one is tried from the start. Candles are never mixed across venues.
- **Never simulated.** Providers flagged `simulated` are skipped. The synthetic dev mode exists only for local development and is labelled `simulated: true`.
- **Recorded provenance.** The evidence (hashed into `evidenceHash`) carries `source` and `sourceAttempts` (each source tried, ok/error). The thesis row stores `scoring_status` (`scored` / `pending` / `unscorable`), `scoring_source`, `scoring_note` and `scoring_checked_at`.
- **Unscorable markets.** If no allowed source can serve the window (for example CAKE: not listed on OKX, and Binance refusing the evaluator's IP), the thesis stays visible with "Cannot be scored right now" and the reason. After its deadline it becomes **Unresolved**, with the reason (`unscorable`) and the attempts in its evidence. It is never resolved in the author's favour.
- **PancakeSwap reference price: not used.** A historical on-chain price per 1h candle would need archive-node reads at past blocks (not available on the free public RPC) and a different high/low model than exchange candles, so it is not a straightforward, comparable substitute. It can be added later as a new, separately-hashed methodology.

Live note (2026-11-19): Binance's public API returns HTTP 418 to the Render free-tier egress, so live scoring currently comes from OKX for BNB/BTC/ETH/USDC; CAKE theses are unscorable until a listed source is reachable.
