# Runbook: deploy to BSC testnet / mainnet and verify on BscScan

> Status: **deployed to BSC mainnet on 2026-11-19 (IST)**, all five contracts verified on BscScan and Sourcify. Addresses, tx hashes and owner settings: [docs/deployments/bsc-mainnet.md](../deployments/bsc-mainnet.md).

## Prerequisites
- A deployer wallet funded with testnet tBNB (chain 97) or, for mainnet, a small amount of BNB. Keep its key in your shell or secret manager only. **Never commit it.**
- `ETHERSCAN_API_KEY`: an Etherscan V2 / BscScan API key (used by `forge --verify` for chains 56 and 97).
- RPC URLs: `BSC_TESTNET_RPC_URL` (e.g. https://bsc-testnet-rpc.publicnode.com), `BSC_RPC_URL` (e.g. https://bsc-rpc.publicnode.com).

## Testnet (chain 97)
The official Agent ID registry is on BSC mainnet. On testnet, either pass `AGENT_ID_ADDRESS` of a testnet Agent ID deployment if one is published, or let the script deploy the labelled `MockAgentID`.
```bash
cd packages/contracts
export DEPLOYER_PRIVATE_KEY=...            # funded testnet key (never commit)
export BSC_TESTNET_RPC_URL=https://bsc-testnet-rpc.publicnode.com ETHERSCAN_API_KEY=...
forge script script/Deploy.s.sol --rpc-url bsc_testnet --broadcast --verify
unset DEPLOYER_PRIVATE_KEY
```
Output: `deployments/97.json`. API: `CHAIN_ID=97 RPC_URL=$BSC_TESTNET_RPC_URL DEPLOYMENT_FILE=.../deployments/97.json`.

## Mainnet (chain 56): required for the hackathon
```bash
cd packages/contracts
export DEPLOYER_PRIVATE_KEY=...  BSC_RPC_URL=https://bsc-rpc.publicnode.com  ETHERSCAN_API_KEY=...
export OUTCOME_OWNER=0x...       # recommended: a multisig; EVALUATOR_ADDRESS=0x... (disclosed evaluator)
CONFIRM_MAINNET=yes forge script script/Deploy.s.sol --rpc-url bsc --broadcast --verify
unset DEPLOYER_PRIVATE_KEY
```
On chain 56 the script always uses the official Agent ID registry `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`, and the API refuses any other registry.

## AtlasPay (ATLAS Pay), chain 56

`Deploy.s.sol` also deploys AtlasPay when it runs a full deploy. To add **only** AtlasPay to an existing deployment:
```bash
cd packages/contracts
export BSC_RPC_URL=https://bsc-rpc.publicnode.com ETHERSCAN_API_KEY=...
read -rs DEPLOYER_PRIVATE_KEY && export DEPLOYER_PRIVATE_KEY   # typed by you, hidden, kept out of shell history; never commit or paste it anywhere
CONFIRM_MAINNET=yes forge script script/DeployPay.s.sol --rpc-url bsc --broadcast --verify
unset DEPLOYER_PRIVATE_KEY
```
The guards (`DeployPay.checkConfig`, tested in `DeployGuards.t.sol`) refuse chain 56 unless `CONFIRM_MAINNET=yes`, the
registry is the official Agent ID `0x60B9…022F`, and the token is BSC USDT `0x55d3…7955`. `MockStable` is never
deployed on 56. AtlasPay has no owner, so the deployer keeps no power over it. The deployer only needs gas, and no payment funds are involved.

The deploy writes `deployments/56.pay.json`. Then:
1. Read-only check: `cd apps/api && npx tsx src/tools/preflight.ts --pay <AtlasPay address>`. It checks for bytecode and that
   `agentId()`/`stableToken()` are pinned correctly.
2. On Render, set `ATLAS_PAY_ADDRESS=<address>` and `PAY_START_BLOCK=<startBlock from 56.pay.json>`, then redeploy. Leave
   `STABLE_TOKEN_ADDRESS` unset (chain 56 forces USDT).
3. `/pay/config` now reports `status: "deployed"`. The web send sheet switches from "Contracts pending deployment"
   to "Authorize in Agentic Wallet".
4. Make one small real payment between two Agent IDs you control. The receipt shows *Provisional* and then *Final* after 15 confirmations.
5. Rerun `tests/e2e/live-smoke.mjs`.

## Verify manually (if `--verify` failed)
```bash
forge verify-contract <address> src/AtlasThesisRegistry.sol:AtlasThesisRegistry --chain 56 \
  --constructor-args $(cast abi-encode "constructor(address)" <identityRegistry>) --watch
```
Repeat for each contract with its constructor arguments. The order and arguments are in `script/Deploy.s.sol`. Confirm the "Contract Source Code Verified" badge on bscscan.com for all four.

## Production API settings
`NODE_ENV=production CHAIN_ID=56 AGENT_ID_MODE=onchain MARKET_DATA_MODE=live PUBLIC_ORIGIN=https://<domain> MESSAGE_KEY=<32B base64> COOKIE_SECURE=true REDIS_URL=... STORAGE_DRIVER=s3 ...`. The API refuses to boot if any of these is unsafe. Use a database owner role with BYPASSRLS only for `DATABASE_URL` (migrations and system jobs), and `atlas_app` for `APP_DATABASE_URL`.

## Post-deploy checklist
- [ ] All 4 contracts verified on BscScan; addresses added to the README and submission form
- [ ] `/config` shows chain 56, `agentIdIsMock: false`, explorer links
- [x] One real Agent ID holder logs in (signature or `registerIdentity` fallback) and publishes a thesis (rishug4436.ai, thesis #1, 2026-11-19)
- [x] Indexer reaches `final` for those events (15 confirmations)
- [ ] AtlasPay: preflight `--pay` passes, `/pay/config` reports `deployed`, one real Agent ID → Agent ID payment shows a Final receipt
