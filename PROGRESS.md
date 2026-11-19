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

### 2026-11-18 22:20 IST — free-tier deploy attempt
- [x] Neon `atlas-social` (free, Singapore): migrations + RLS + atlas_app role (verified: 16/43 RLS tables, app role NOBYPASSRLS, sees 0 users without context). Box→Neon port 5432 is blocked by box egress, so migrations ran over Neon's WebSocket driver (443) from /workspace/.neon-mig (outside repo).
- [x] Contracts-pending mode: API 503 CONTRACTS_PENDING for on-chain actions, /config.contractsDeployed + null contract addresses, web banner + ContractsPending states (welcome on-chain tab, step-up, compose thesis → "Draft saved (off-chain)"), anchor card hidden. Tests: api 27 (3 new).
- [x] Production-config rehearsal on box (chain 56, official Agent ID, live data): tests/e2e/live-smoke.mjs 15/15 PASS; screenshots docs/evidence/live-rehearsal/.
- [x] render.yaml (free plan, secrets sync:false).
- [x] Render API service live (was blocked on GitHub app access; fixed by owner 2026-11-19).
- [x] Vercel web/admin live (team consent approved 2026-11-19 11:41 IST).
- Secrets (MESSAGE_KEY, APP_DB_PASSWORD, DB URLs) live only in /workspace/.atlas-secrets (chmod 700, outside the repo); pass to Render via file substitution, never print.

### 2026-11-19 — ATLAS Arena 1.0 (resume from first unchecked)
- [x] A1 reputation-engine: arena.ts (Skill Score v2, eligibility tiers, consistency, rising, thesis moves, near-duplicate detection, points planner/levels/achievements) + unit tests
- [x] A2 migration 003_arena.sql (snapshots/entries/methodologies/point_events/user_levels/achievements/user_achievements/integrity flags/seasons; RLS; append-only triggers)
- [x] A3 API: lib/arena.ts + routes/arena.ts (leaderboards, methodology, history, score-breakdown, points, achievements, compare, performance-evidence), snapshot job, admin challenge adjudication; API tests
- [x] A4 demo seed (local only, labelled demo, refuses chain 56)
- [x] A5 web: /arena (tabs, windows, filters, sortable table, context panel, mobile cards, Proof Drawer, Points, Compare Lab), /performance redirect, profile Arena section + Rank Journey
- [x] A6 e2e /arena + screenshots docs/evidence/screenshots/arena/
- [x] A7 docs (docs/methodology/arena-skill-score-v2.md, points), push, CI green
- 2026-11-19 11:48 IST A1-A3 done: reputation-engine 27 tests (23 arena), API 47 tests (20 arena)
- 2026-11-19 12:00 IST A4 done: seed-arena.ts publishes 70 demo theses on local anvil (simulated=true, demo evidence), backfills 10 weekly snapshots; seed.ts --no-arena skips
- 2026-11-19 12:55 IST A5-A6 done: /arena web (tabs, windows, filters, sortable table, context panel, mobile cards, Proof Drawer, Points, Compare Lab, Rank Journey, profile Arena tab), /performance redirects; e2e 10/10 (3 arena + arena screenshots), screenshots docs/evidence/screenshots/arena/
- 2026-11-19 13:00 IST A7: docs/methodology/arena-skill-score-v2.md, README; contracts 44, unit (reputation-engine 27), API 47, pytest 2, typecheck, builds, secret scan all green locally

### 2026-11-19 12:15 IST — LIVE (free tiers)
- Web https://atlas-social-web.vercel.app · Admin https://atlas-social-admin.vercel.app · API https://atlas-social-api.onrender.com (Render free, Singapore) · DB Neon free (Singapore).
- Allowed origins set to the real Vercel hosts (PUBLIC_ORIGIN/RP_ID/WEB_ORIGINS). Contracts-pending mode active (no mainnet contracts yet).
- Fix: Binance public API returns 418 from Render egress → added OKX public API as second real source (LiveChainProvider; never simulated) + tests; web hides missing tickers and labels the source.
- Fix: API boot diagnostics + DB connect timeouts.
- live-smoke.mjs against live URLs: 15/15 PASS; screenshots docs/evidence/live/.
- Open: CAKE price unavailable while OKX serves; outcome scoring still Binance-only; Render free sleeps after idle; uploads ephemeral until R2.

### 2026-11-19 — Agent ID CLI onboarding (decision: baw for first-time verification, passkeys for returning users; auth not redesigned)
- [x] packages/auth/src/onboarding.ts (browser-safe, `@atlas/auth/onboarding`): error catalog (code → title/message/fix/action/fallback), local signature pre-check, pasted `baw` output parser (preview/execute/result/settings/agent-id/address, 953004, 3518xx, 20003008, stale/foreign/other-chain previews, shell-safe IDs), per-shell quoting (POSIX, PowerShell 7+, cmd/MSVCRT); challenge.ts: SIGNER_MISMATCH (+recovered address), SIGNATURE_TRUNCATED, ERC1271_REJECTED
- [x] API: challenge timing fields + previewByShell, `replaces` (supersede → CHALLENGE_SUPERSEDED), GET /auth/challenge/:id state, GET /auth/errors, structured details {title, fix, action, fallback, challengeBurned}, RATE_LIMITED retryAfterSeconds
- [x] Web: /onboarding wizard (prereqs → wallet → generated commands with countdown, stale marking, one-click/auto regenerate → verify → passkey), guided on-chain fallback (honest Contracts pending state), passkey sign-in + recovery copy, /onboarding/guide for judges; /welcome links to it and uses the same error explainer + countdown
- [x] Tests: auth unit 24 (16 new), API 64 (14 new onboarding), e2e 19 (9 onboarding: desktop wizard + passkey, expiry/regenerate, auto-renew, errors, real local-chain fallback, contracts-pending fallback, reduced motion, guide, mobile); screenshots docs/evidence/screenshots/onboarding/
- [x] Docs: runbooks/agent-id-signin-test.md rewritten around the wizard; hackathon/TESTER-ONBOARDING.md (still not posted anywhere); live-smoke.mjs checks /auth/errors, onboarding pages and the non-holder wizard error
- 2026-11-19 14:05 IST deployed (Render + Vercel auto-deploy from main); live-smoke 20/20 PASS incl. /auth/errors, /onboarding(+guide) desktop+mobile and the live non-holder wizard error; screenshots docs/evidence/live/
- 2026-11-19 14:22 IST checkpoint after interruption: verified clean tree, origin/main = a8a857b, CI green on both commits, live /onboarding + /auth/errors 200. Onboarding task COMPLETE.

### 2026-11-19 — ATLAS Pay (Agent ID → Agent ID payments; non-custodial; never touches Arena)
- [x] P1 contracts: AtlasPay.sol (execution-time ownerOf(keccak(handle)) + expectedRecipient binding, sender must hold Agent ID, BNB forwarded, USDT SafeERC20 transferFrom w/ exact-amount check, nonReentrant, no owner/receive), MockStable (local only), Deploy.s.sol (+AtlasPay, mainnet pinned to registry+USDT), DeployPay.s.sol (pay-only, pure checkConfig), ABIs exported; forge 71 (21 AtlasPay unit/fuzz + 3 invariants incl. never-holds-funds + 5 deploy-guard)
- [x] P2 API: migration 005_pay (payment_intents/payments/payment_requests, RLS, accept_payments privacy), routes/pay.ts (config, send-flow recipient resolve rate-limited, prepare unsigned txs + gas, requests, receipts, baw fallback), indexer PaymentSent (reorg-aware), API tests incl. Arena isolation
- [x] P3 web: send sheet (profile + DM; full resolved address, gas, "Authorize in Agentic Wallet" with baw contract-call + EIP-1193 steps, tracker waits for the indexed PaymentSent), tip (post/thesis), request cards (DM/post/share page, no address shown), /pay receipts + accept-payments toggle, pending state + baw fallback (resolve → paste → warnings → explicit confirm → send cmd). Fixes: sheet portalled (post cards), ReceiptTracker loop, global rate limit keyed per account at preHandler
- [x] P4 seed-pay.ts (real local anvil payments with MOCK USDT, refuses chain 56); e2e pay.spec.ts 7 (5 desktop + 2 @mobile, real local txs); full e2e 26/26; screenshots docs/evidence/screenshots/pay/ (18)
- [x] P5a docs: docs/security/atlas-pay-review.md, docs/runbooks/atlas-pay-baw-fallback.md (9 discrepancies), deploy-bsc.md AtlasPay section, README; preflight --pay; live-smoke +5 API checks + /pay pages. Local: forge 71, unit 106, API 85, e2e 26, typecheck + web/admin builds, secret scan clean
- [x] P5b pushed (af67db7), CI 44497938873 green (node, analytics, contracts, e2e), Render live with /pay/config status=pending (chain 56, BSC USDT), Vercel /pay live; live-smoke 28/28 PASS (docs/evidence/live/live-smoke-pay-2026-11-19.txt). AtlasPay NOT deployed: awaiting user deployer wallet (docs/runbooks/deploy-bsc.md)
- baw docs verified 2026-11-19 (binance-skills-hub send.md + domain-resolve.md): see docs/research/skills-hub/
- 2026-11-19 14:40 IST P2 done: routes/pay.ts (config, recipient [send-flow only, 10/min, 25 distinct/day, audited], prepare [exact approve, expectedRecipient binding, gas], fallback [baw resolve→confirm→send], requests, receipts, settings), lib/pay.ts indexer projection (cascade on reorg, request re-open), chain-indexer pay contract; API 84 (20 pay + on-chain BNB/USDT/reorg), auth unit 28, wallet-integration 11

### 2026-11-19 — ATLAS Agent Gateway (scoped agent tokens + MCP; agents never sign or move assets)
- [x] G1 API: migration 006_agents (agents, hashed agent_tokens, append-only agent_attributions/evidence_verifications/agent_audit_log, attribution lock + permanent published agent theses, RLS); bearer agent auth (no cookie mixing), route allowlist with per-route scopes, per-token rate limit, audit log (no bodies), AGENT_CANNOT_SIGN on wallet step-up; /agents/{scopes,tokens,revoke,audit,me}; /theses/:id/thread + /verifications (server-computed verdicts); agent attribution on drafts/reviews/challenges/verifications; AI Analysts board (separate population, no Points, human boards/Skill Score/legacy performance exclude agent theses); /pay/agent/prepare (exact name only, unsigned or baw fallback)
- [x] G2 MCP: services/agent-gateway (official MCP SDK; 17 tools, Zod schemas) mounted at POST /mcp (stateless Streamable HTTP, tools call the REST routes in-process with the same bearer) + stdio bin; tests: gateway unit 5, API agents 12 (incl. real MCP client over HTTP); API 97 total
- [x] G3 web: Settings → Agents (create with scopes/expiry + wallet step-up, token shown once with Claude/Cursor/ChatGPT/stdio config, revoke, audit log), agent badges (post cards, thesis, reviews), Research thread tab (+ human Verify evidence), Arena AI Analysts tab, landing section "The Social Intelligence Network for Humans and AI Agents"
- [x] G4 skills/atlas-social/SKILL.md + references/setup.md + references/security.md (= docs/security/agent-gateway.md); seed-agents.ts (local only, refuses 56, real MCP client in-memory, model "demo-agent (local seed)"); e2e agents.spec.ts 4 (3 desktop + 1 mobile, real MCP client over HTTP); full e2e 30/30; screenshots docs/evidence/screenshots/agents/ (10); stdio server checked locally with a real stdio MCP client; live-smoke + agent checks (no prod token created)
- Local 2026-11-19 16:20 IST: unit 115, API 97, e2e 30, typecheck, web+admin builds green
- 2026-11-19 16:35 IST deployed: CI green on 8999327 (44504787688) and 0c492de (44508612723); Render API serves /mcp + /agents/* + /leaderboards/ai-analysts, Vercel serves Settings → Agents, AI Analysts tab, landing section. live-smoke 37/37 PASS incl. MCP: real client without token → 401, forged token → 401 AGENT_TOKEN_INVALID, /mcp/info 17 tools; authenticated tools/list SKIPPED on prod (no token created; run with ATLAS_SMOKE_AGENT_TOKEN). docs/evidence/live/live-smoke-agents-2026-11-19.txt. Agent Gateway COMPLETE.

### 2026-11-19 — ATLAS Connect ("Continue with Binance Agentic Wallet"; browser-bound handoff, no QR/pairing login)
- [x] C1 API: migration 007_connect (connect_intents: hashed public code + hashed browser verifier, system-only/RLS; login_challenges purpose 'connect'; sessions.wallet_check_source), packages/auth/src/connect.ts (ATC- 128-bit codes, stages, handoff texts, IdentityStates), routes/connect.ts (browser: create/poll/redeem/cancel bound to an httpOnly SameSite=Strict verifier cookie; handoff: open/challenge/report/complete/tx by public code only, never a session), shared linkOrCreateAccount (same account by Agent ID token), /auth/session `states` {agentId, wallet (time-limited check), financial (per-transaction)}, /pay/handoff (contract-call steps or official baw fallback; tx verified on chain vs the reviewed step, reverted ≠ paid). Tests: API connect 17 (replay, expiry, wrong browser, forged verifier, leaked-code Agent ID confirmation, wrong owner, signature mismatch + burn + lockout, superseded, ERC-1271, step-up binding, pay tx verify/mismatch/revert/foreign/duplicate, fallback transfer), auth unit +6. API 114.
- [x] C2 public MCP POST /mcp/connect (5 code-gated tools → handoff routes only, no cookies/token) + /mcp/info connect block; skills/atlas-social/references/connect.md + SKILL.md section; API test with a real MCP client (API 115)
- [x] C3 tools/atlas-baw-connect (PREVIEW, not published): execFile allowlist (no shell, no server), signs only AtlasLogin for this wallet/loginId/site, typed `yes` approval, app-confirmation polling, pay contract-call + fallback (resolve must match registry owner, address book); labelled test double test/fake-baw.mjs (local chain only, refuses 56); 12 unit tests; manual local run: companion + test double → API (onchain mode, real local MockAgentID NFT) → browser redeem → new account
- [x] C4 web (602514b): /welcome primary "Continue with Binance Agentic Wallet" (code + countdown ring + stepper driven by reported stages, tabs Your AI agent / Terminal / MCP, explicit "Continue as name.ai" confirmation, #400 honest fallback), passkey kept, Advanced options = guided wizard + manual address + on-chain proof; /welcome/profile for new accounts; Settings → Security "Identity & wallet" (3 separate states); step-up dialog defaults to Agentic Wallet; send sheet "Authorize with ATLAS Connect" / "Hand off to my Agentic Wallet" (full address, network, token, amount, fee, risks; manual paths kept). Motion with MotionConfig reducedMotion=user.
- [x] C5 (c359abe + test fixes): tests/e2e/connect.spec.ts 4 desktop + 1 mobile (companion + labelled fake baw → local API → browser redeem; existing user keeps account; wrong browser + replay; decline + 953004; pay via Connect with indexed receipt); full e2e 35/35 locally; screenshots docs/evidence/screenshots/connect/01–14; docs/security/atlas-connect.md, docs/runbooks/atlas-connect-test.md (real-baw acceptance test), honest status (#400 filed against SOLVD's login, #375) in README/security.md/runbooks; live smoke +7 Connect checks → 45/45 PASS on production (docs/evidence/live/live-smoke-connect-2026-11-19.txt). Render + Vercel deployed.
- [x] Real `baw` acceptance PASSED 2026-11-19 ~20:50 IST: baw 1.12.0, rishug4436.ai (0xc44edDcFfA4227d38bc92a7cA5990953AA7Ff0cF) signed AtlasLogin twice, no 953004; browser redeem → /home. #400 still open upstream, not hit.

### 2026-11-19 — ATLAS Connect follow-up (phone explanation, cold start, Developer Mode hint)
- Guest "Skip for now" (t217u): ON HOLD per owner — not built.
- [x] D1 web: lib/resilient-fetch.ts (retry non-JSON/502/503/504/network with backoff ≤75 s for GET + Connect intent creation; never raw parse errors; waking signal) + WakingBanner "Waking up ATLAS servers… (up to a minute)", /welcome warm-up ping to /health; Connect "How this works" + phone note; Developer Mode hint in handoff panel + 351802 status; web unit tests (6) wired into CI
- [x] D2 e2e +4 (sleeping-API Connect retry with waking banner, GET retry through 502/HTML + warm-up ping, How this works + Developer Mode off via fake baw, mobile phone note) → full e2e 39/39; screenshots connect/15–18; runbook notes; live smoke checks phone note + Developer Mode hint
- [x] D3 Vercel serves the new client (waking banner in chunk), Render healthy; live smoke 45/45 PASS incl. phone note + Developer Mode hint (docs/evidence/live/live-smoke-connect-followup-2026-11-19.txt)

### 2026-11-19 — Bugs from the owner's real-user browser session (after the real-baw PASS)
- [x] Acceptance recorded: confirmed with baw 1.12.0 on Nov 19, 2026 (README, /welcome + /onboarding status, runbook result log, security docs, skill + companion READMEs); #400 still open upstream, not hit (c6600d7)
- [x] E1 thesis "Review & publish" showed "servers waking up": Render logs showed POST /theses 200 then /theses/:id/prepare → 503 in ~25 ms, i.e. a JSON 503 CONTRACTS_PENDING from a running API. The D1 retry client classified every 503 as a cold start. Fix: any JSON `{error}` body is a real API answer (shown as-is, never retried, no banner); only non-JSON/network/proxy 5xx count as waking. The existing pending path (draft saved off-chain, "not committed or scored") works again. Unit +2, e2e fixes.spec
- [x] E2 first Connect sign-in "went to /home": Render logs show the redeem was followed by GET /profiles/me + right panel and no /feed, i.e. the browser did land on /welcome/profile, but that page rendered inside the full app shell (looked like Home) and nothing brought an unfinished profile back. Fix: migration 008 profiles.setup_completed_at (backfilled for profiles already edited); every sign-in path (Connect, manual, passkey, wizard) routes to /welcome/profile until the profile is saved once ("Skip for now" also completes it); /welcome/* renders without the app shell; in-app "Finish setting up your profile" banner. API +1 test
- [x] E3 /settings full load flashed signed-out UI: shell + settings/messages/notifications/compose/pay show skeletons until the session resolves. e2e asserts no signed-out text while /auth/session is delayed
- [x] E4 Trending topics empty: skeleton while loading, labelled empty state when there are none
- Tests: API 116, web unit 8, e2e 43/43 (fixes.spec 4 new), all unit + typecheck green; screenshots connect/19–23
- [x] Deployed: Render applied 008_profile_setup.sql (15:33 UTC); Vercel serves the new client; live smoke 47/47 PASS (docs/evidence/live/live-smoke-bugfixes-2026-11-19.txt)
- 2026-11-19 ~22:45 IST **BSC mainnet deploy** (owner-authorized, throwaway deployer funded by the owner): Deploy.s.sol → AtlasIdentityRegistry 0x2cc2Dbb408EAE7bb64f75754Da2bc650B9AD7532, AtlasThesisRegistry 0x7E9071Ccba153e4f340f767511B4afa31F776E5A, AtlasReviewRegistry 0xE6c7409CfBbd546207Ea0D33273e640e5B5a1E45, AtlasOutcomeRegistry 0xB9A4533dFEb7F44d10ee60e434a1C3800D20a97d (owner = Agentic Wallet 0xc44edDcFfA4227d38bc92a7cA5990953AA7Ff0cF, no evaluator yet), AtlasPay 0x425523F9a2A417709124233da27AfCDf0c78007E; start block 134541328; all 5 verified on BscScan + Sourcify (exact). Gas 5.61M @0.05 gwei = 0.00028 BNB. DeployPay.s.sol not run (Deploy.s.sol already deploys AtlasPay). Render env set (DEPLOYMENT_FILE + addresses + PAY_START_BLOCK); /config contractsDeployed=true, /pay/config deployed. Live smoke now fails any page that still says "pending deployment" once contracts are live; fixed the static onboarding guide text. Details: docs/deployments/bsc-mainnet.md. TODO (owner): setEvaluator via baw.
