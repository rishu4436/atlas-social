# Architecture

```
 Browser (apps/web, apps/admin)  ──/api rewrite (first-party cookies)──►  apps/api (Fastify + Zod + OpenAPI)
        │  unsigned tx / baw commands                                         │  pg (atlas_app role, RLS)    ──► Postgres (+TimescaleDB candles)
        ▼                                                                     │  BullMQ (REDIS_URL) or in-process ──► notification-worker
 User's own Agentic Wallet / EIP-1193 wallet ──signs & broadcasts──► BSC     │  viem ──► chain-indexer (reorg-aware) ──► chain_events
                                                                              │  market-data (Binance public) · outcome-engine (ATLAS-M1)
                                                                              │  ai-research (4 agents, optional LLM) · reputation-engine (TS + Polars)
                                                                              └► S3-compatible storage (MinIO / S3) or local
```

## Monorepo

| Path | Purpose |
|---|---|
| `apps/web` | Product UI: every Blueprint §3 route (`/welcome /home /explore /compose /thesis/:id /markets /markets/:asset /trade/:asset /squads /squads/:slug /ai /u/:agentName /performance /proof/:id /notifications /messages /settings /admin`) |
| `apps/admin` | Standalone moderation console (same API, moderator role required) |
| `apps/api` | REST API, migrations (`migrations/*.sql`), demo seed, workers (indexer, outcome evaluator) |
| `packages/contracts` | Solidity registries + Foundry tests + `Deploy.s.sol` |
| `packages/shared-types` | ABIs, token allowlist, markets, canonical hashing, methodology |
| `packages/agent-id` | Agent ID resolver: on-chain (official registry ABI) or a labelled mock for dev |
| `packages/auth` | EIP-712 challenge, verification (EOA + ERC-1271), `baw` command builders |
| `packages/wallet-integration` | PancakeSwap V2 swap preparation, ATLAS contract call encoders, safety checks |
| `packages/trade-proof` | Verifies a swap receipt belongs to the claimant |
| `packages/design-system` | Tokens (Obsidian/Slate/Signal Cyan/Emerald/Coral), motion presets, components |
| `services/*` | market-data, outcome-engine, reputation-engine (+ `analytics/` Python/Polars), ai-research, chain-indexer, notification-worker |
| `infrastructure/` | docker-compose (Postgres/Timescale, Redis, MinIO, anvil, apps) and the Dockerfile |
| `tests/e2e` | Playwright specs and screenshot capture |

## Key flows

**Login.** `POST /auth/challenge {wallet}` checks Agent ID ownership and returns typed data, `baw` commands and an on-chain fallback tx. The user signs (or sends the fallback tx). `POST /auth/verify` atomically consumes the challenge, links the account (1 Agent ID ↔ 1 account) and starts a session.

**Thesis.** `POST /theses` (draft) → `POST /theses/:id/prepare` (commitment = keccak(domain, chainId, registry, author, terms, salt); returns an unsigned `publishThesis` / `commitThesis`). The user broadcasts it, then `POST /theses/:id/confirm {txHash}` checks the receipt sender and matching event. The indexer is authoritative: after N confirmations events become final, and provisional ones are rolled back on a reorg.

**Outcome.** The committed methodology (hash in every thesis) is evaluated on real 1h candles: ATLAS-M1 theses use Binance only; ATLAS-M1.1 (current) uses Binance, then OKX if Binance cannot serve the whole window, with the source and every attempt recorded in the evidence ([outcome price sources](methodology/outcome-price-sources.md)). Prices are never simulated; if no allowed source lists the market the thesis is shown as unscorable with the reason. Ambiguity, gaps or stale data give Unresolved. An evaluator key, if configured, proposes on-chain to `AtlasOutcomeRegistry` with a dispute window.

**Trade.** `POST /trade/quotes` (read-only `getAmountsOut` on BSC) → `POST /trade/prepare {acknowledgeRisk:true}` (unsigned steps: exact approve, then swap with min-out) → the user executes in their wallet → `POST /trade/evidence {txHash}` verifies the receipt (sender, router, recipient, amounts, confirmations).

**Feed ranking (For You).** freshness × (evidence + relationship + topic + quality) − (reports + link warnings), with author-diversity decay. Profit and follower count are never ranking inputs. Chronological and Verified tabs bypass personalisation, and the personalised feed can be turned off in Settings.

## Motion and design

`motion/react` with `MotionConfig reducedMotion="user"`:
- Route transitions (`app/template.tsx`) and staggered list enters.
- Shared-layout sliding indicators for tabs and navigation.
- Spring hover and press states, shimmer skeletons, spring number tickers.
- Price charts with morphing paths and a crosshair.
- Committed-badge reveal and reaction particle bursts.

Only transform and opacity are animated. `prefers-reduced-motion` also disables CSS animations in `tokens.css`.
