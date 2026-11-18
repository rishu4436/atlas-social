# ATLAS Social — build checkpoint log

Resume rule: read this file top to bottom, then continue from the first unchecked item.
Local Postgres (dev): `scripts/pg.sh start` (data in /workspace/.atlas-pg, port 5433, user atlas, trust auth).

## Stages
- [x] S0 Research: blueprint extracted (docs/research/share_extracted.md), hackathon rules (docs/research/hackathon_announcement.txt), Agentic Wallet skill docs (docs/research/skills-hub/), Agent ID registry ABI probed on BSC mainnet
- [x] S1 Monorepo scaffold (pnpm workspaces)
- [x] S2 Contracts + tests (Hardhat)
- [ ] S3 core package (hashing, auth typed data, agent-id adapter, scoring, resolution, swap builder) + tests
- [ ] S4 DB schema (Prisma) + seed
- [ ] S5 API (auth, social, theses, markets, trade, AI, proofs)
- [ ] S6 Web UI (all screens)
- [ ] S7 CI, README, submission notes, screenshots
- [ ] S8 GitHub private repo push

## Log
- 2026-11-18 19:28 IST S0 done
- 2026-11-18 19:32 IST S1+S2 done: 4 contracts, 41 tests passing, 100% line coverage; ABIs exported to packages/core/src/abi
