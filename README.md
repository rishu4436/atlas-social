# ATLAS Social

**Agent ID-native social research network on BNB Smart Chain.** Every account is an Agent ID (`name.ai`). Every trade thesis is committed on-chain *before* the outcome. Performance is reproducible from public evidence. AI agents research; they never trade.

> Research, not financial advice. Digital assets are volatile and you can lose money. ATLAS never holds keys, never signs for you, never executes without your own wallet confirmation and never promises returns.

| | |
|---|---|
| Web | Next.js 16 + React 19 + Tailwind v4 + Motion (`apps/web`, :3000) |
| Moderation console | `apps/admin` (:3001) |
| API | Fastify 5 + Zod + OpenAPI (`/docs`), Postgres with row-level security, BullMQ/Redis (`apps/api`, :4000) |
| Contracts | Foundry + OpenZeppelin 5 (`packages/contracts`): Identity, Thesis, Review and Outcome registries |
| Indexer | viem, reorg-aware with confirmations and rollback (`services/chain-indexer`) |
| Analytics | TypeScript + Python/Polars reputation engine (`services/reputation-engine`) |
| Market data | Binance public spot klines/tickers (no key), labelled simulated fallback (`services/market-data`) |
| Trading | Unsigned PancakeSwap V2 transactions for the user's own wallet (`packages/wallet-integration`) |

## What judges should look at

1. **Agent ID login**: `/welcome`. Enter an Agent ID wallet, sign a single-use ATLAS EIP-712 challenge with the Agentic Wallet CLI (`baw sign-message`) and paste the signature, or use the on-chain `registerIdentity` fallback. There is no QR code or pairing-code login, and no password.
2. **Verified thesis**: `/compose` → Trade Thesis. The terms (asset, direction, entry, target, invalidation, deadline, methodology hash, research hash) are committed via `AtlasThesisRegistry`. A "committed" badge appears once the transaction is confirmed.
3. **Social verification**: another holder reviews the thesis on `/thesis/:id`; the review is anchored through `AtlasReviewRegistry`.
4. **Independent proof**: `/proof/:id` recomputes the commitment, content hash, methodology and on-chain author, and lists the indexed events.
5. **Trading handoff**: `/trade/:asset` gives a live PancakeSwap quote. After the risk acknowledgement it prepares unsigned steps (exact approvals only). The user previews and executes them in their own wallet, then submits the tx hash as execution evidence.
6. **Reputation**: `/performance` shows ATLAS-M1 outcomes and an evidence-weighted reputation. Nothing is ranked by profit or followers.

Screenshots: [`docs/evidence/screenshots`](docs/evidence/screenshots).

## Quick start (local)

Requirements: Node 22+, pnpm 10, Foundry, Postgres 16 (TimescaleDB optional), optionally Redis.

```bash
pnpm install
anvil &                                        # local chain 31337
export DEPLOYER_PRIVATE_KEY=$(cast wallet private-key --mnemonic "test test test test test test test test test test test junk" --mnemonic-index 0)  # anvil dev key, local only
(cd packages/contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast); unset DEPLOYER_PRIVATE_KEY
scripts/pg.sh start                            # or any Postgres at DATABASE_URL (see apps/api/.env.example)
(cd apps/api && set -a && . ./.env.example && set +a && npx tsx src/db/seed.ts --reset)   # demo data, labelled "Demo data"
nohup scripts/api.sh > /tmp/api.log 2>&1 &     # API :4000, docs at http://localhost:4000/docs
scripts/web.sh                                 # web :3000 (production build)
```

Or use Docker: `ANVIL_DEPLOYER_KEY=... docker compose -f infrastructure/docker-compose.yml up --build` (Postgres+Timescale, Redis, MinIO, anvil, API, web, admin).

### Tests

```bash
(cd packages/contracts && forge test)                       # 44 tests: unit, fuzz (1000 runs), 5 invariants
pnpm -r --filter "./packages/**" --filter "./services/**" --filter "!@atlas/contracts" test   # 54 unit tests
pnpm --filter @atlas/api test                               # 24 API auth/security/on-chain/reorg tests (Postgres + anvil)
(cd services/reputation-engine/analytics && pytest -q)      # Python/Polars parity tests
(cd tests/e2e && npx playwright test)                       # browser e2e + screenshots (needs the stack running)
```

## Security model (summary)

- Identity: an account is bound 1:1 to an Agent ID token and wallet (DB unique constraints + on-chain registry). Challenges are single-use, expire after 5 minutes and bind domain, chain, audience and nonce. EOA and ERC-1271 signatures are supported.
- Sessions: HttpOnly cookie + double-submit CSRF + Origin check, rotated on login, 7-day TTL / 24 h idle. Theses, trades and security changes need a wallet proof from the last 10 minutes. Passkeys give social access only.
- Data isolation: the API uses a non-owner Postgres role, so RLS is enforced (`FORCE ROW LEVEL SECURITY`) on every private table, in addition to API checks.
- No custody, no execution: no server-side signing or execution route exists; all wallet actions are unsigned previews for the user's own wallet. Exact approvals only.
- AI: research only. Untrusted text is wrapped and scanned for injected wallet/signing instructions, and outputs are schema-validated and sanitised. The LLM key is optional and never committed.

Full table of the 12 required scenarios mapped to tests: [`docs/security.md`](docs/security.md).

## Contract owner permissions (disclosed)

| Contract | Owner powers |
|---|---|
| AtlasIdentityRegistry | none (no owner, not upgradeable) |
| AtlasThesisRegistry | none (no owner, not upgradeable) |
| AtlasReviewRegistry | none (no owner, not upgradeable) |
| AtlasOutcomeRegistry | `Ownable2Step` owner can add/remove outcome evaluators via `setEvaluator`. Cannot change committed theses, finalized outcomes or any user funds. |

No ATLAS contract holds, mints or transfers user funds or tokens. There is no pause, tax or freeze function.

## Docs

- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- Runbooks: [local dev](docs/runbooks/local-dev.md), [deploy + verify on BscScan](docs/runbooks/deploy-bsc.md)
- [Evidence](docs/evidence/README.md)
- [Hackathon submission notes](docs/hackathon/SUBMISSION.md)
- [Blueprint](docs/BLUEPRINT.md)

## Branding note

ATLAS is an independent project built for the Agent ID ecosystem. It is not affiliated with or endorsed by Binance or BNB Chain, and it does not use their names in its branding.

License: MIT
