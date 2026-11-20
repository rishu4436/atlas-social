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
- **Evaluator set 2026-11-19 23:18 IST:** the owner's Agentic Wallet called `setEvaluator(0x3DBEDBA2c3D9009d8cca39B3eF5f575ba5629B7E, true)`
  ([tx](https://bscscan.com/tx/0xcc4c2e4f3276dff27c001e26b35cfc0dc91c474f16a8581829194c6ad1ef7004)); `isEvaluator()` = true, `evaluatorCount()` = 1.
  The evaluator is a dedicated EOA whose key lives only in the API's environment (`EVALUATOR_PRIVATE_KEY` on Render). It can only *propose*
  outcomes, which anyone holding an Agent ID can challenge during the 48 h dispute window; the owner can remove it with `setEvaluator(<addr>, false)`.
- AtlasIdentityRegistry, AtlasThesisRegistry, AtlasReviewRegistry and AtlasPay have **no owner, no admin, no upgrade path**.
- The throwaway deployer `0x40e38955DDDdC6f05Eb878530fdB49D0ea6953dC` holds **no role** in any contract.

## Gas
5 transactions, 5,607,982 gas at 0.05 gwei = **0.0002803991 BNB**. Deployer balance after: 0.0007196009 BNB (left untouched).

## API configuration (Render)
`DEPLOYMENT_FILE=../../packages/contracts/deployments/56.json` plus explicit `IDENTITY_REGISTRY`, `THESIS_REGISTRY`, `REVIEW_REGISTRY`,
`OUTCOME_REGISTRY`, `ATLAS_PAY_ADDRESS`, `PAY_START_BLOCK=134541328`. `STABLE_TOKEN_ADDRESS` is unset (chain 56 forces USDT).

Note: `DeployPay.s.sol` was **not** run, because `Deploy.s.sol` already deploys AtlasPay. Running it would have created a second, unused AtlasPay.

## Post-deploy actions from the owner's Agentic Wallet (2026-11-19, approved by the owner)
All Agentic Wallet transactions went through `baw contract-call preview` (checked: target contract, selector, value 0, no balance/allowance/authority
changes, no risks) and then `baw contract-call execute`.

| Time (IST) | Action | From | Tx | Status | Gas paid |
|---|---|---|---|---|---|
| 23:18:43 | `AtlasOutcomeRegistry.setEvaluator(0x3DBE…9B7E, true)` | rishug4436.ai `0xc44e…f0cF` (baw) | [`0xcc4c2e4f…1ef7004`](https://bscscan.com/tx/0xcc4c2e4f3276dff27c001e26b35cfc0dc91c474f16a8581829194c6ad1ef7004) | success, block 134545996 | 70,394 gas × 0.0652 gwei = 0.00000459 BNB |
| 23:19:21 | Gas for the evaluator: 0.0001 BNB transfer | throwaway deployer `0x40e3…53dC` | [`0xbb9ad8bb…be2339cf`](https://bscscan.com/tx/0xbb9ad8bbf4dff565af8c6acecd349ca973771aa5fd87bece3dcdec60be2339cf) | success, block 134546080 | 21,000 gas × 0.05 gwei = 0.00000105 BNB |
| 23:26:41 | First real thesis: `AtlasThesisRegistry.publishThesis` (thesis #1, BNB long) via ATLAS Connect login → app prepare → baw | rishug4436.ai (baw) | [`0xef2eb64f…de9b1792`](https://bscscan.com/tx/0xef2eb64fbdf253f8532f2e2c6ffaa24b053178c3518fee796a26714ede9b1792) | success, block 134547058; `ThesisCommitted` + `ThesisPublished` indexed, status final | 391,950 gas × 0.0789 gwei = 0.00003094 BNB |

Thesis #1 (author rishug4436.ai, published from an existing private draft): *"BNB long, bounce off the range low"*: "BNB has held this support a
few times now and selling looks tired. Taking a long at market with a stop just under the range low. If it loses that level I am wrong and out."
Market entry (BNB ≈ 586), target 618.72, stop 571.58, 72 h window (until 2026-11-22 23:26 IST), ATLAS-M1.1 on Binance 1h candles.
`/theses/7e7c391d-9b50-42b6-ac4b-0ec8e11ef2e8/proofs`: all five checks pass.

Found and fixed during this run (42b2975): drafts saved while the contracts were pending kept the zero registry address, so `/confirm` could not
match the publish event. `prepare` and `confirm` now bind such drafts to the live registry (regression test in `apps/api/test/onchain.test.ts`).

**AtlasPay test payment: skipped.** The Agentic Wallet holds exactly one Agent ID (`balanceOf` = 1), and AtlasPay reverts `SelfPayment()` when the
recipient's Agent ID resolves to the sender. A real payment needs a second Agent ID the owner controls (in a different wallet); ATLAS will not pay
anyone else's Agent ID for a test.

## Two-holder acceptance (2026-11-20, approved by the owner)
Second Agent ID: **minadevi.ai** `0xc37F9A734490C736BDf7F1ACB5d6efc44D37A43C` (owner-controlled, separate Agentic Wallet, own `baw` session).
Every transaction: app prepare → `baw contract-call preview` (target, selector, decoded args, value, risks checked) → execute → app confirm.

| Time (IST) | Action | From | Tx | Status | Gas paid |
|---|---|---|---|---|---|
| 14:49 | ATLAS Connect login (companion, AtlasLogin EIP-712, no tx) → redeem in its own browser session → new account → profile "Mina" | minadevi.ai | – | PASS | – |
| 14:52:19 | `AtlasPay.payNative` 0.0001 BNB → rishug4436.ai (tokenId = keccak256("rishug4436"), expectedRecipient `0xc44e…f0cF`, kind direct, no memo) via `/pay/handoff` + companion `pay` | minadevi.ai (baw) | [`0x1ed148db…1b97eaa2`](https://bscscan.com/tx/0x1ed148db4a717cc8ddbf2c50f42c942e6ac5497b7890a066bbc3aa4b1c97eaa2) | success, block 134670442; `PaymentSent` indexed, API stage **finalized · paid**, sender receipt final | 52,252 gas = 0.00000482 BNB |
| 14:54:08 | `AtlasReviewRegistry.publishReview(1, Neutral, 0x993c…ce80)` on thesis #1 | minadevi.ai (baw) | [`0x4b067395…86bac38a`](https://bscscan.com/tx/0x4b067395dd208c74a7314d741f261812e678be486aaa189a717bdcd386bac38a) | success, block 134670684; `/reviews/confirm` ok, shown on-chain on the thesis | 180,745 gas = 0.00001341 BNB |

Review text (NEUTRAL): "range low held again so yeah fair. i would still wait for a proper reclaim before sizing in tho, been too many wicks under it this month"

`/metrics/onchain-agents` after this run: **distinctAgentIdAddresses = 2** (final).

Not done in this run:
- **Payment request (A requests, B pays):** blocked: rishug4436.ai's `baw` session on the test machine had signed out, so it could not sign in to ATLAS to create the request. Needs the owner to re-pair `baw`.
- **USDT payment:** skipped: rishug4436.ai holds 0 USDT (`balanceOf` = 0), so there was nothing to pay with.
