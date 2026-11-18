# ATLAS Social — build checkpoint log

Resume rule: read this file top to bottom, then continue from the first unchecked item.
Full blueprint: docs/BLUEPRINT.md (follow exactly). Steering: build fast, continuously.
Local chain: anvil on :8545 (state /workspace/.atlas-run/anvil-state.json), deployed via `forge script script/Deploy.s.sol` (see packages/contracts).
Local Postgres (dev): `scripts/pg.sh start` (data in /workspace/.atlas-pg, port 5433, user atlas, trust auth).

## Stages
- [x] S0 Research: blueprint extracted (docs/research/share_extracted.md), hackathon rules (docs/research/hackathon_announcement.txt), Agentic Wallet skill docs (docs/research/skills-hub/), Agent ID registry ABI probed on BSC mainnet
- [x] S1 Monorepo scaffold (pnpm workspaces)
- [x] S2 Contracts (Foundry, per BLUEPRINT §14): AtlasIdentityRegistry, AtlasThesisRegistry, AtlasReviewRegistry, AtlasOutcomeRegistry + unit/fuzz/invariant tests; Deploy.s.sol; local anvil deploy -> deployments/31337.json
- [ ] S3 packages: shared-types (ABIs, zod), agent-id, auth, wallet-integration, trade-proof, design-system
- [ ] S4 services: market-data, outcome-engine, reputation-engine (TS + Python/Polars), ai-research (4 agents), chain-indexer (reorg-aware), notification-worker
- [ ] S5 apps/api: Fastify + Zod + OpenAPI + Prisma (Postgres RLS), all §15 endpoints, security tests (§17 table)
- [ ] S6 apps/web: Next.js + Tailwind, all §3 routes; apps/admin
- [ ] S7 CI, README, submission notes, screenshots
- [ ] S8 GitHub private repo push

## Log
- 2026-11-18 19:28 IST S0 done
- 2026-11-18 19:32 IST S1+S2 done: 4 contracts, 41 tests passing, 100% line coverage; ABIs exported to packages/core/src/abi
- 2026-11-18 IST: switched contracts from Hardhat to Foundry with blueprint names; 44 tests (fuzz 1000 runs + 5 invariants) passing
