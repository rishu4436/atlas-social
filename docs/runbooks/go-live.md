# Runbook: go live (hosting → BSC mainnet → official Agent ID)

This runbook is executed **by the project owner**. It needs funds and accounts that only you have. Nothing in it has been run yet. Each step lists who provides what. Prices and free-tier limits change, so check each provider's current terms before relying on them.

## 0. What you must provide
| Item | Why | Where it goes |
|---|---|---|
| Deployer wallet with ~0.02–0.05 BNB on BSC mainnet (gas for 4 contract deployments) | Deploy contracts | your shell only: `DEPLOYER_PRIVATE_KEY` (never commit, never paste into chat) |
| Etherscan V2 API key (covers BscScan, chains 56/97) | `forge --verify` | `ETHERSCAN_API_KEY` |
| Hosting accounts (below) | Live product | provider dashboards |
| A domain or the provider's https URL | `PUBLIC_ORIGIN`, passkey `RP_ID` | API env |
| `MESSAGE_KEY` = `openssl rand -base64 32` | DM encryption at rest | API secret env |
| Optional: an outcome evaluator wallet + a multisig for `OUTCOME_OWNER` | On-chain outcome proposals; disclosed owner power | deploy env / API `EVALUATOR_PRIVATE_KEY` secret |
| Optional: an LLM key (OpenAI-compatible) | AI narration (deterministic without it) | `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` |
| Your decision to make the GitHub repo public (or at least rely on BscScan-verified source) | Hackathon "open-sourced" rule | GitHub settings |

## 1. Hosting (free tier where possible)

Recommended split: the web UI on a Next.js host, the API (with the always-on indexer and evaluator loop) on a container host, plus managed Postgres. The web app proxies `/api/*` to the API (`API_URL`), so session cookies stay first-party on the web domain.

| Component | Free-tier option(s) | Notes |
|---|---|---|
| `apps/web` | **Vercel** (Hobby), Cloudflare Pages + next-on-pages, Netlify | Root dir `apps/web`, build `pnpm --filter @atlas/web build`, env `API_URL=https://<api-host>`. |
| `apps/admin` | Vercel (second project, root `apps/admin`) | Same `API_URL`. Keep the URL private; moderator role is still enforced by the API. |
| `apps/api` | **Koyeb** (free instance), Render (free web service *sleeps when idle*, which pauses the indexer), Google Cloud Run (`--min-instances=1` for the indexer; small cost), or any VPS | Deploy `infrastructure/docker/node.Dockerfile`, target `api`. Health check `GET /health`. |
| Postgres | **Neon** (free), Supabase (free) | Postgres 16 with RLS. TimescaleDB is optional: migration 002 skips it if the extension is unavailable. Use the owner connection string for `DATABASE_URL` and create the app role per §3. |
| Redis (optional) | Upstash (free) | `REDIS_URL=rediss://…`. Leave it unset to use the in-process queue (fine for the hackathon scale). |
| Object storage | Cloudflare R2 (free tier), Backblaze B2 | `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. |
| BSC RPC | publicnode (`https://bsc-rpc.publicnode.com`), or a free keyed RPC (Ankr, QuickNode, NodeReal) for reliability | `RPC_URL` and `BSC_RPC_URL` |

Alternative for a single box: a small VPS with `docker compose -f infrastructure/docker-compose.yml up -d`. Remove the `anvil`/`deploy` services and set the production env below. Put Caddy or nginx in front for https.

## 2. Deploy contracts to BSC mainnet and verify on BscScan

Optional rehearsal first: run the same steps on testnet (chain 97, `--rpc-url bsc_testnet`). The script deploys a labelled MockAgentID there.

```bash
cd packages/contracts
pnpm install                              # OpenZeppelin 5.4.0
forge test                                # must be green
export BSC_RPC_URL=https://bsc-rpc.publicnode.com
export ETHERSCAN_API_KEY=...              # Etherscan V2 key
export OUTCOME_OWNER=0x...                # recommended: multisig (owner can only add/remove evaluators)
export EVALUATOR_ADDRESS=0x...            # optional, disclosed evaluator (only auto-enabled when OUTCOME_OWNER == deployer)
read -rs DEPLOYER_PRIVATE_KEY && export DEPLOYER_PRIVATE_KEY   # type it, nothing echoes; never store in a file in the repo
CONFIRM_MAINNET=yes forge script script/Deploy.s.sol --rpc-url bsc --broadcast --verify
unset DEPLOYER_PRIVATE_KEY
```

- On chain 56 the script **requires** the official Agent ID registry `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` and refuses any override or mock.
- Output: `deployments/56.json`. Commit it (addresses are public).
- If verification did not complete, run `forge verify-contract` per contract (see [deploy-bsc.md](deploy-bsc.md)) and confirm the green "Contract Source Code Verified" mark on bscscan.com for all four.
- Read-only check (no keys):
  `cd apps/api && npx tsx src/tools/preflight.ts --deployment ../../packages/contracts/deployments/56.json`

## 3. Switch from the mock Agent ID to the official contract

The mock exists only on local/test chains. Switching is configuration only; no code changes are needed:

| Setting | Dev (now) | Production |
|---|---|---|
| `CHAIN_ID` | 31337 | **56** |
| `RPC_URL` | http://127.0.0.1:8545 | BSC RPC |
| `DEPLOYMENT_FILE` | deployments/31337.json (MockAgentID) | **deployments/56.json** (agentId = `0x60B9…022F`, `agentIdIsMock: false`) |
| `AGENT_ID_MODE` | onchain (against the mock) or mock (tests) | **onchain** |
| `MARKET_DATA_MODE` | live-with-fallback | **live** |
| `NODE_ENV` | development | **production** |

The API's production guard refuses to start with mock mode, a chain other than 56, synthetic data, no `MESSAGE_KEY` or a non-https origin. On chain 56 `loadContracts` rejects any registry other than the official one. The seed script refuses chain 56, so no demo data reaches production. The dev banner disappears automatically when `/config.agentIdIsMock` is false.

Full production API env:
```
NODE_ENV=production HOST=0.0.0.0 PORT=4000
PUBLIC_ORIGIN=https://<web-domain>  WEB_ORIGINS=https://<web-domain>,https://<admin-domain>
RP_ID=<web-domain>  RP_NAME="ATLAS Social"  COOKIE_SECURE=true
DATABASE_URL=<owner/BYPASSRLS role>  APP_DATABASE_URL=<atlas_app role>  APP_DB_PASSWORD=<strong>
CHAIN_ID=56 RPC_URL=<bsc rpc> BSC_RPC_URL=<bsc rpc> DEPLOYMENT_FILE=/repo/packages/contracts/deployments/56.json
AGENT_ID_MODE=onchain MARKET_DATA_MODE=live MESSAGE_KEY=<32B base64>
STORAGE_DRIVER=s3 S3_ENDPOINT=... S3_BUCKET=... S3_REGION=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
REDIS_URL=<optional>  RUN_WORKERS=true  AI_API_KEY/AI_BASE_URL/AI_MODEL=<optional>  EVALUATOR_PRIVATE_KEY=<optional secret>
```
Migrations run on boot. `APP_DB_PASSWORD` sets the `atlas_app` login password. On managed Postgres where the owner role cannot create roles, create `atlas_app` (LOGIN, NOBYPASSRLS) in the dashboard first.

## 4. Smoke test the live stack
1. `npx tsx src/tools/preflight.ts --api https://<api-host> --deployment …/56.json --wallet <your Agent ID wallet>` → all PASS
2. Open `https://<web-domain>/welcome`. There must be no dev banner.
3. Run the real sign-in test: [agent-id-signin-test.md](agent-id-signin-test.md).
4. Publish one thesis and anchor your identity; check both txs on BscScan and that `/proof/:id` shows 5/5 checks.
5. Have a second holder review the thesis on-chain.
6. Fill the contract addresses into `docs/hackathon/SUBMISSION.md` and README.

## 5. Rollback
- Web/API: redeploy the previous image or commit. Contracts are immutable. If a bug is found, deploy new registries, update `deployments/56.json`, and disclose it. Old records stay on-chain.
- Never "fix" by pointing production at a mock or a testnet.

## 6. Live beta status (2026-11-18)

| Piece | State | Where |
|---|---|---|
| Postgres | **Live.** Neon project `atlas-social` (`twilight-snow-45805671`), free plan, AWS Singapore (`aws-ap-southeast-1`), Postgres 16, database `atlas`. Migrations 001+002 applied; RLS on the same 16 of 43 tables as local; `atlas_app` role is LOGIN, NOBYPASSRLS, password set. | console.neon.tech |
| API (Render, free, Singapore) | **Blocked: Render cannot read the private GitHub repo.** `create_web_service` returned "repository URL is invalid or unfetchable". | needs the Render GitHub app (below) |
| Web + admin (Vercel, Hobby) | **Blocked: the Vercel connector has no access to the `rishu4436s-projects` team** (403), so no project could be created. | needs team consent + Vercel GitHub app (below) |
| Contracts | Not deployed (no funded key). The API runs in **contracts-pending mode**: `/config.contractsDeployed=false`, every on-chain action returns `503 CONTRACTS_PENDING`, and the web shows "Contracts pending deployment" states and a live-beta banner. Nothing is faked. | §2 |

### Unblock steps (owner only, ~5 minutes)
1. **Render to GitHub:** open https://dashboard.render.com/ → New → Web Service → "Connect GitHub" (or https://github.com/apps/render/installations/new) and grant the Render app access to `rishu4436/atlas-social` (only that repo is enough).
2. **Vercel team access:** ask the agent for a fresh consent link (`authorize_team_access`; each link works once and expires after 10 minutes), open it and approve for **rishu4436's projects**.
3. **Vercel to GitHub:** https://github.com/apps/vercel/installations/new → grant access to `rishu4436/atlas-social`.
4. Tell the agent "unblocked". It then creates the services with these settings (no paid plans):
   - Render `atlas-social-api`: free, singapore, build `npx -y pnpm@10.34.6 install --frozen-lockfile --prod=false`, start `cd apps/api && ../../node_modules/.bin/tsx src/main.ts`, health `/health`, env per `render.yaml` (also usable as a Blueprint). Secrets are generated on the operator box and passed straight from files into Render's env; they are never committed or echoed.
   - Vercel `atlas-social-web`: root `apps/web`, env `API_URL=https://<render api host>`. Vercel `atlas-social-admin`: root `apps/admin`, same `API_URL`.
   - Then the API's `PUBLIC_ORIGIN`, `RP_ID` and `WEB_ORIGINS` are set to the real Vercel hosts.
5. Smoke test: `cd tests/e2e && BASE_URL=https://<web> API_URL=https://<api> OUT=../../docs/evidence/live node live-smoke.mjs` (read-only: health, config, live markets, PancakeSwap quote, non-holder refusal, page renders and screenshots).

### Production-config rehearsal (done, local)
The same production config (NODE_ENV=production, CHAIN_ID=56, official Agent ID via publicnode, live market data, no contracts) was run on the box and `live-smoke.mjs` passed 15/15. A real Agent ID holder wallet got a login challenge (`contractsPending: true`, no on-chain fallback offered); a non-holder got `403 NOT_AGENT_ID_HOLDER`. Screenshots: `docs/evidence/live-rehearsal/` (local rehearsal, **not** the public site).

Free-tier caveats: the Render free instance sleeps after ~15 min idle (first request takes ~30-60 s), its disk is ephemeral (uploads use `STORAGE_DRIVER=local` until R2 is configured), and the in-process notification queue is used (no Redis).
