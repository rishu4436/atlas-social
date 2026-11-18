# ATLAS Social — build checkpoint log

Resume rule: read this file top to bottom, then continue from the first unchecked item.
Full blueprint: docs/BLUEPRINT.md (follow exactly). Steering: build fast, continuously.
Local chain: anvil on :8545 (state /workspace/.atlas-run/anvil-state.json), deployed via `forge script script/Deploy.s.sol` (see packages/contracts).
Local Postgres (dev): `scripts/pg.sh start` (data in /workspace/.atlas-pg, port 5433, user atlas, trust auth).

## Stages
- [x] S0 Research: blueprint extracted (docs/research/share_extracted.md), hackathon rules (docs/research/hackathon_announcement.txt), Agentic Wallet skill docs (docs/research/skills-hub/), Agent ID registry ABI probed on BSC mainnet
- [x] S1 Monorepo scaffold (pnpm workspaces)
- [x] S2 Contracts (Foundry, per BLUEPRINT §14): AtlasIdentityRegistry, AtlasThesisRegistry, AtlasReviewRegistry, AtlasOutcomeRegistry + unit/fuzz/invariant tests; Deploy.s.sol; local anvil deploy -> deployments/31337.json
- [x] S3 packages: shared-types (ABIs, zod), agent-id, auth, wallet-integration, trade-proof, design-system
- [x] S4 services: market-data, outcome-engine, reputation-engine (TS + Python/Polars), ai-research (4 agents), chain-indexer (reorg-aware), notification-worker
- [x] S5 apps/api: Fastify + Zod + OpenAPI + pg (Postgres RLS, app role atlas_app), all §15 endpoints, security tests (§17 table)
- [x] S6 apps/web: Next.js + Tailwind, all §3 routes; apps/admin
- [x] S7 CI (GitHub Actions: contracts, analytics, node, e2e — all green), README, docs, submission notes, screenshots
- [x] S8 GitHub private repo push (rishu4436/atlas-social, private)

## Log
- 2026-11-18 19:28 IST S0 done
- 2026-11-18 19:32 IST S1+S2 done: 4 contracts, 41 tests passing, 100% line coverage; ABIs exported to packages/core/src/abi
- 2026-11-18 IST: switched contracts from Hardhat to Foundry with blueprint names; 44 tests (fuzz 1000 runs + 5 invariants) passing
- 2026-11-18 20:15 IST S3-S5 done: packages + services tested; API 24 tests (auth 9, security 11, onchain/reorg 4); demo seed on anvil
- 2026-11-18 20:40 IST S6 done: apps/web all blueprint routes with motion design (motion v14, sliding tab indicators, stagger, shimmer skeletons, animated tickers, committed badge reveal, reduced-motion); apps/admin standalone console (:3001)
- 2026-11-18 20:40 IST e2e: tests/e2e Playwright (system chrome) 6 passing; screenshots in docs/evidence/screenshots

## Runtime (box)
- Postgres: scripts/pg.sh start (:5433). anvil :8545. API: `nohup scripts/api.sh > /workspace/.atlas-run/api.log &` (:4000). Web: `scripts/web.sh` (:3000, builds then starts). Admin: `cd apps/admin && npx next start -p 3001`.
- e2e: `cd tests/e2e && npx playwright test` (needs API+web+anvil running).
- 2026-11-18 20:55 IST S7 done: infrastructure/ (compose + Dockerfile, unverified locally: no docker on box), CI green on GitHub, docs/{architecture,security,runbooks,evidence,hackathon}
## Remaining (needs user/external inputs)
- Funded BSC key + BscScan (Etherscan V2) API key -> deploy + verify (docs/runbooks/deploy-bsc.md)
- Real Agentic Wallet / Agent ID end-to-end login test (baw EIP-712 issue #400 -> on-chain fallback)
- Hosting (web+api+Postgres+Redis) and onboarding >=30 Agent ID holders; optional LLM key; make repo public before submission
- Independent contract review; pnpm audit

### 2026-11-18 — polish + go-live prep
- Home "Anchor your Agent ID on-chain" card (drives registerIdentity txs that count toward the 30-address goal); StepUp defaultMode/title props.
- Deploy.s.sol: chain 56 hard-requires official Agent ID registry 0x60B9…022F.
- apps/api/src/tools/preflight.ts: read-only mainnet preflight (ran: registry ok, "SPACE ID Agent ID"/AI).
- New docs: runbooks/go-live.md, runbooks/agent-id-signin-test.md, hackathon/TESTER-ONBOARDING.md. e2e 5/5 pass, screenshots refreshed.
