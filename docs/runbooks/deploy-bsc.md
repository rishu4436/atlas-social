# Runbook: deploy to BSC testnet / mainnet and verify on BscScan

> Status: **not yet deployed.** No funded deployer key was available in the build environment, so contracts are only deployed to local anvil. Everything below is ready to run.

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
- [ ] One real Agent ID holder logs in (signature or `registerIdentity` fallback) and publishes a thesis
- [ ] Indexer reaches `final` for those events (15 confirmations)
