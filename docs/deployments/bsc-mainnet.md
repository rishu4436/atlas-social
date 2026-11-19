# BSC mainnet deployment (chain 56)

Deployed 2026-11-19 ~22:45 IST by a throwaway deployer funded by the project owner, with `script/Deploy.s.sol`
(`CONFIRM_MAINNET=yes forge script script/Deploy.s.sol --rpc-url bsc --broadcast --verify`). Machine-readable record:
[`packages/contracts/deployments/56.json`](../../packages/contracts/deployments/56.json). Start block: **134541328**.

| Contract | Address | Deploy tx | Block | Verified |
|---|---|---|---|---|
| AtlasIdentityRegistry | [`0x2cc2Dbb408EAE7bb64f75754Da2bc650B9AD7532`](https://bscscan.com/address/0x2cc2Dbb408EAE7bb64f75754Da2bc650B9AD7532#code) | [`0x398de253…aeec4`](https://bscscan.com/tx/0x398de253e5adc6f912d847accb86a6e8da8f1f5baf0a07a6a304fb1710aaeec4) | 134541328 | BscScan ✓, Sourcify exact match ✓ |
| AtlasThesisRegistry | [`0x7E9071Ccba153e4f340f767511B4afa31F776E5A`](https://bscscan.com/address/0x7E9071Ccba153e4f340f767511B4afa31F776E5A#code) | [`0x6caa12e3…e5367`](https://bscscan.com/tx/0x6caa12e360981436fff02fb74589e5c0fe061cca720741452da2d450f4ee5367) | 134541430 | BscScan ✓, Sourcify exact match ✓ |
| AtlasReviewRegistry | [`0xE6c7409CfBbd546207Ea0D33273e640e5B5a1E45`](https://bscscan.com/address/0xE6c7409CfBbd546207Ea0D33273e640e5B5a1E45#code) | [`0x15b94203…3dda84`](https://bscscan.com/tx/0x15b94203a335ca3f02a7b28f6cc6c48b50f02d3294ec2847284dfe680b3dda84) | 134541435 | BscScan ✓, Sourcify exact match ✓ |
| AtlasOutcomeRegistry | [`0xB9A4533dFEb7F44d10ee60e434a1C3800D20a97d`](https://bscscan.com/address/0xB9A4533dFEb7F44d10ee60e434a1C3800D20a97d#code) | [`0xc9a95abd…a6d303`](https://bscscan.com/tx/0xc9a95abd4b9f4b23089c809c05c99ca8da86d17efd971f584431271710a6d303) | 134541440 | BscScan ✓, Sourcify exact match ✓ |
| AtlasPay | [`0x425523F9a2A417709124233da27AfCDf0c78007E`](https://bscscan.com/address/0x425523F9a2A417709124233da27AfCDf0c78007E#code) | [`0x7295fbb5…e6e7c1`](https://bscscan.com/tx/0x7295fbb512081fb5ca0baa7f13918f9b68e0d9a1ad5977f5fd4163198df6e7c1) | 134541445 | BscScan ✓, Sourcify exact match ✓ |

Pinned dependencies (constructor arguments, checked on-chain after deploy):
- Agent ID registry: the official `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` (all five contracts).
- AtlasPay stable token: BSC USDT `0x55d398326f99059fF775485246999027B3197955` (`AtlasPay.stableToken()`); `preflight.ts --pay` passes.
- AtlasReviewRegistry → AtlasThesisRegistry `0x7E90…6E5A`; AtlasOutcomeRegistry → AtlasThesisRegistry `0x7E90…6E5A`, dispute window 172800 s (48 h).

## Owner / admin powers (disclosed)
- **AtlasOutcomeRegistry** is the only contract with an owner (`Ownable2Step`). Owner = the project owner's Agentic Wallet
  **`0xc44edDcFfA4227d38bc92a7cA5990953AA7Ff0cF`** (`owner()` checked on-chain; `pendingOwner()` = 0). The owner can only add/remove
  evaluator addresses and transfer ownership in two steps; it cannot edit theses, outcomes already finalised, or move funds.
- **No evaluator is set yet** (`evaluatorCount() = 0`). Until the owner calls `setEvaluator(<address>, true)` from the Agentic Wallet,
  outcomes are computed and shown off-chain only (with evidence), and nothing is proposed on-chain.
- AtlasIdentityRegistry, AtlasThesisRegistry, AtlasReviewRegistry and AtlasPay have **no owner, no admin, no upgrade path**.
- The throwaway deployer `0x40e38955DDDdC6f05Eb878530fdB49D0ea6953dC` holds **no role** in any contract.

## Gas
5 transactions, 5,607,982 gas at 0.05 gwei = **0.0002803991 BNB**. Deployer balance after: 0.0007196009 BNB (left untouched).

## API configuration (Render)
`DEPLOYMENT_FILE=../../packages/contracts/deployments/56.json` plus explicit `IDENTITY_REGISTRY`, `THESIS_REGISTRY`, `REVIEW_REGISTRY`,
`OUTCOME_REGISTRY`, `ATLAS_PAY_ADDRESS`, `PAY_START_BLOCK=134541328`. `STABLE_TOKEN_ADDRESS` is unset (chain 56 forces USDT).

Note: `DeployPay.s.sol` was **not** run, because `Deploy.s.sol` already deploys AtlasPay. Running it would have created a second, unused AtlasPay.
